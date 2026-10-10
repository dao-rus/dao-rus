import {readCallAvailability,readOwnVote,countPendingVecheWithDatabase,wizardHref,wizardValues} from "./veche-presentation";
import { parseEmptySettings,readEmptySettings,saveEmptySettings,setEmptyMarkWithDatabase,readEmptySignals,readPublicFreezes,recordFreezeWithDatabase } from "./veche-empty";
import { readFinanceSettings,saveFinanceSettings,createPaidCallWithDatabase } from "./veche-finance";
import { getVisibleDarusBookWithDatabase } from "./darus-holds";
import { listProposalsWithDatabase,ownProposalFlags } from "./proposals";
import { createSignatureCallWithDatabase, setSignatureWithDatabase, saveSignatureSettings, readSignatureSettings, refreshSignatureCalls } from "./veche-signatures";
import { announceSignatureCollection } from "./veche-announcement";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { Pool } from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProposalWithDatabase, ProposalEligibilityError } from "./proposals";
import { castVoteWithDatabase, closePollWithDatabase, closeDuePolls, getPollViewWithDatabase, parseVecheSettings, saveVecheSettings, VecheError, type PollConfig } from "./veche-polls";
import { PollContent } from "../components/poll-content";
import { interfaceTextFields, type InterfaceTextValues } from "./interface-texts";
import { announcePoll } from "./veche-announcement";

const databaseUrl = process.env.VECHE_TEST_DATABASE_URL;
const schema = `veche_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
const texts = Object.fromEntries(interfaceTextFields.map(field => [field.key,field.defaultValue])) as InterfaceTextValues;
let schemaCreated = false, author: string, legacy: string, server: ChildProcess | undefined, serverOutput = "";
const http = process.env.VECHE_HTTP_TESTS === "1";
const base = "http://127.0.0.1:3107";
let cookie: string, preSnapshotCall:string, preSnapshotRequired:number,preSnapshotDeadline:string;
async function member(city: string | null = "Synthetic locality", status = "participant") {
  const id = randomUUID();
  await pool.query("INSERT INTO participants(id,display_name,membership_status,residence_name,residence_type,residence_country) VALUES($1,$2,$3,$4,$5,$6)", [id, `Private voter ${id}`, status, city?.trim() ? city : null, city?.trim() ? 'city' : null, city?.trim() ? 'Synthetic country' : null]);
  return id;
}
async function poll(config: Partial<PollConfig> = {}) {
  return (await createProposalWithDatabase(pool, author, "Synthetic poll", "Synthetic question", { circle: "dao", mode: "secret", deadline: null, ...config })).id;
}
const view = (id: string) => getPollViewWithDatabase(pool, id);
const vote = (id: string, participantId: string, choice: string = "yes") => castVoteWithDatabase(pool, id, participantId, choice);
const close = (id: string) => closePollWithDatabase(pool, id, author);
async function request(path: string, rsc = false, headers: Record<string,string> = {}) {
  const response = await fetch(base + path, { headers: { cookie, ...(rsc ? { RSC: "1" } : {}), ...headers }, redirect: "manual" });
  expect(response.status).toBe(200);
  if (rsc) expect(response.headers.get("content-type")).toContain("text/x-component");
  return response.text();
}

describe.skipIf(!databaseUrl)("Veche invariants on isolated PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/veche_tests") throw new Error("Use isolated local veche_tests");
    await pool.query("BEGIN; SELECT pg_advisory_xact_lock(49001,0); CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public; COMMIT;");
    await pool.query(`CREATE SCHEMA ${schema}`); schemaCreated = true;
    const directory = new URL("../../migrations/", import.meta.url);
    for (const file of readdirSync(directory).filter(name => name.endsWith(".sql") && name < "046_").sort()) await pool.query("BEGIN;" + readFileSync(new URL(file,directory),"utf8") + ";COMMIT;");
    author = await member(); legacy = (await createProposalWithDatabase(pool,author,"Legacy question","Legacy body")).id;
    const before = (await pool.query("SELECT id,title,body,status,created_at FROM proposals ORDER BY id")).rows;
    await pool.query("BEGIN;" + readFileSync(new URL("046_veche_opinion_polls.sql",directory),"utf8") + ";COMMIT;");
    expect((await pool.query("SELECT id,title,body,status,created_at FROM proposals ORDER BY id")).rows).toEqual(before);
    for (const file of readdirSync(directory).filter(name => name.endsWith(".sql") && name > "046_veche_opinion_polls.sql").sort()){
      if(file.startsWith("050_")){
       await pool.query("UPDATE veche_settings SET signature_fraction_city=0.5,signature_cooldown_days=1 WHERE singleton");
       preSnapshotCall=(await createProposalWithDatabase(pool,author,"Existing collection","Synthetic body",{circle:"city",mode:"secret",deadline:null,bySignatures:true})).id;
       const old=(await pool.query("SELECT poll_signatures_required,poll_signature_deadline FROM proposals WHERE id=$1",[preSnapshotCall])).rows[0];preSnapshotRequired=Number(old.poll_signatures_required);preSnapshotDeadline=new Date(old.poll_signature_deadline).toISOString();
      }
      await pool.query("BEGIN;" + readFileSync(new URL(file,directory),"utf8") + ";COMMIT;");
    }
    if (http) {
      const token = randomBytes(32).toString("base64url"); cookie = `dao_session=${token}`;
      await pool.query("INSERT INTO sessions(token_hash,participant_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [createHash("sha256").update(token).digest("hex"),author]);
      url.searchParams.set("options", `-c search_path=${schema},public`);
      const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", DATABASE_URL: url.toString(), APP_BASE_URL: base, ADMIN_PARTICIPANT_IDS: author,
        OPENAI_API_KEY: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_RECEPTION_BOT_TOKEN: "", TELEGRAM_FORUM_CHAT_ID: "", TELEGRAM_NOTIFICATIONS_ENABLED: "false" };
      server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3107"], { cwd: process.cwd(), env, windowsHide: true, stdio: ["ignore","pipe","pipe"] });
      server.stdout?.on("data", chunk => { serverOutput += String(chunk); }); server.stderr?.on("data", chunk => { serverOutput += String(chunk); });
      let ready = false;
      for (let attempt=0; attempt<80; attempt++) {
        try { const response = await fetch(base+"/api/veche/invalid", { signal: AbortSignal.timeout(3000) }); if (response.status===401) { ready=true; break; } } catch { /* Wait for local compilation. */ }
        if (server.exitCode !== null) break;
        await new Promise(resolve => setTimeout(resolve,1000));
      }
      if (!ready) throw new Error("Isolated Next test server did not become ready");
    }
  }, 150000);
  async function cleanup(){if(schemaCreated){await pool.query(`DROP SCHEMA ${schema} CASCADE`);schemaCreated=false;}await pool.end();}
  afterAll(async () => {
    if (server && server.exitCode===null && server.pid) {
      if (process.platform==="win32") {
        try {execFileSync("taskkill",["/PID",String(server.pid),"/T","/F"],{ windowsHide:true,stdio:"ignore" });}
        catch(error) {try {process.kill(server.pid,0);}catch(check){if((check as NodeJS.ErrnoException).code==="ESRCH")return await cleanup();throw check;}throw error;}
      }
      else server.kill("SIGTERM");
    }
    await cleanup();
  });

  it("preserves legacy proposals and does not turn them into polls", async () => {
    expect(await view(legacy)).toBeNull(); await expect(vote(legacy,author)).rejects.toMatchObject({ code:"missing" });
    expect((await pool.query("SELECT poll_circle FROM proposals WHERE id=$1",[legacy])).rows[0].poll_circle).toBeNull();
  });
  it.each([null, ""])("requires a city for the service poll author (%s)",async city => {
    const id=await member(city);
    await expect(createProposalWithDatabase(pool,id,"Question","Body",{ circle:"dao",mode:"secret",deadline:null })).rejects.toBeInstanceOf(ProposalEligibilityError);
  });
  it("rejects malformed config, choices, settings and a departed author", async () => {
    const left=await member("Synthetic locality","left");
    await expect(createProposalWithDatabase(pool,left,"Question","Body",{ circle:"dao",mode:"secret",deadline:null })).rejects.toBeInstanceOf(ProposalEligibilityError);
    await expect(poll({ deadline:new Date(0) })).rejects.toMatchObject({code:"invalid"});
    await expect(vote(await poll(),author,"maybe")).rejects.toMatchObject({code:"invalid"});
    expect(parseVecheSettings({inactivityDays:"",quorumDao:"0",quorumCity:"1"})).toEqual({inactivityDays:null,quorumDao:0,quorumCity:1});
    expect(()=>parseVecheSettings({inactivityDays:"0",quorumDao:"0",quorumCity:"0"})).toThrow(VecheError);
    expect(()=>parseVecheSettings({inactivityDays:"5",quorumDao:"NaN",quorumCity:"0"})).toThrow(VecheError);
  });
  it("accepts changed votes once, including concurrent requests", async () => {
    const id=await poll(), voter=await member();
    await vote(id,voter,"yes"); await vote(id,voter,"no");
    await Promise.all(Array.from({length:8},()=>vote(id,voter,"abstain")));
    expect((await view(id))?.turnout).toBe(1);
    await close(id); expect((await view(id))?.result?.counts).toEqual({yes:0,no:0,abstain:1});
  });
  it("enforces city membership and current participant status, including direct SQL", async () => {
    const id=await poll({circle:"city"});
    for(const voter of [await member("Other synthetic locality"),await member(null),await member("Synthetic locality","left"),await member("Synthetic locality","excluded")]) {
      await expect(vote(id,voter)).rejects.toMatchObject({code:"ineligible"});
      await expect(pool.query("INSERT INTO proposal_votes(proposal_id,participant_id,choice) VALUES($1,$2,'yes')",[id,voter])).rejects.toThrow("Voter is not eligible");
    }
    await vote(id,await member("  SYNTHETIC LOCALITY  ")); expect((await view(id))?.turnout).toBe(1);
  });
  it("allows DAO members from another city and refuses a voter who left after voting", async () => {
    const id=await poll(), voter=await member("Other synthetic locality"); await vote(id,voter);
    await pool.query("UPDATE participants SET membership_status='left' WHERE id=$1",[voter]);
    await expect(vote(id,voter,"no")).rejects.toMatchObject({code:"ineligible"});
    await close(id); expect((await view(id))?.result?.counts.yes).toBe(1);
  });
  it("protects mode, circle, date, author, question and closed-state immutability", async () => {
    const id=await poll();
    for(const assignment of ["poll_mode='open'","poll_circle='city',poll_city='synthetic locality'","poll_deadline=now()+interval '1 day'","title='Altered'"])
      await expect(pool.query(`UPDATE proposals SET ${assignment} WHERE id=$1`,[id])).rejects.toThrow("Poll configuration is immutable");
    await close(id);
    await expect(pool.query("UPDATE proposals SET poll_closed_at=NULL WHERE id=$1",[id])).rejects.toThrow("Closed poll is immutable");
    await expect(vote(id,author)).rejects.toMatchObject({code:"closed"});
  });
  it("hides even open-poll breakdown from the initiator until closure", async () => {
    const id=await poll({mode:"open"}), voter=await member(); await vote(id,voter,"no");
    const open=await view(id); expect(open?.result).toBeNull(); expect(open).not.toHaveProperty("publicVotes");
    expect(JSON.stringify(open)).not.toContain(voter);
    await close(id); const closed=await view(id);
    expect(closed?.publicVotes).toEqual([{participantId:voter,displayName:`Private voter ${voter}`,choice:"no"}]);
  });
  it("never exposes secret identity/choice in safe payload, HTML or events", async () => {
    const id=await poll(), voter=await member(); await vote(id,voter,"no");
    for(const closed of [false,true]) {
      if(closed) await close(id);
      const result=(await view(id))!;
      expect(result).not.toHaveProperty("publicVotes"); expect(JSON.stringify(result)).not.toContain(voter);
      expect(renderToStaticMarkup(<PollContent poll={result} texts={texts} canVote />)).not.toContain(voter);
      expect((await pool.query("SELECT participant_id,payload FROM events WHERE payload->>'proposal_id'=$1",[id])).rows)
        .toEqual([{participant_id:author,payload:{proposal_id:id,title:"Synthetic poll"}}]);
    }
  });
  it("automatically closes at the deadline even when the worker is late", async () => {
    const id=await poll({deadline:new Date(Date.now()+1100)}); await vote(id,author);
    await pool.query("SELECT pg_sleep(1.2)");
    await expect(vote(id,author,"no")).rejects.toMatchObject({code:"closed"});
    expect((await view(id))?.result?.counts.yes).toBe(1);
  });
  it("closes permanent polls after configured inactivity; changed votes are not new arrivals", async () => {
    await saveVecheSettings(pool,{inactivityDays:2,quorumDao:0,quorumCity:0});
    const id=await poll(); await vote(id,author);
    await pool.query("UPDATE proposals SET poll_last_new_vote_at=now()-interval '1 day' WHERE id=$1",[id]);
    await vote(id,author,"no");
    expect(new Date(String((await pool.query("SELECT poll_last_new_vote_at FROM proposals WHERE id=$1",[id])).rows[0].poll_last_new_vote_at)).getTime()).toBeLessThan(Date.now()-23*3600000);
    await pool.query("UPDATE proposals SET poll_last_new_vote_at=now()-interval '3 days' WHERE id=$1",[id]);
    await closeDuePolls(pool); expect((await view(id))?.closedAt).not.toBeNull();
    await saveVecheSettings(pool,{inactivityDays:null,quorumDao:0,quorumCity:0});
  });
  it("only lets the author close a permanent poll; a deadline cannot be shortened", async () => {
    await expect(closePollWithDatabase(pool,await poll(),await member())).rejects.toMatchObject({code:"forbidden"});
    await expect(close(await poll({deadline:new Date(Date.now()+3600000)}))).rejects.toMatchObject({code:"forbidden"});
  });
  it("freezes circle quorum/population at closure and includes abstention", async () => {
    const locality=`Synthetic circle ${randomUUID()}`, initiator=await member(locality), other=await member(locality);
    const id=(await createProposalWithDatabase(pool,initiator,"Synthetic poll","Synthetic question",{circle:"city",mode:"secret",deadline:null})).id;
    await saveVecheSettings(pool,{inactivityDays:null,quorumDao:0,quorumCity:0.75});
    await vote(id,other,"abstain"); await closePollWithDatabase(pool,id,initiator);
    expect((await view(id))?.result).toEqual({counts:{yes:0,no:0,abstain:1},eligible:2,quorum:0.75,quorumReached:false});
    await member(locality); await saveVecheSettings(pool,{inactivityDays:null,quorumDao:0,quorumCity:0});
    expect((await view(id))?.result?.eligible).toBe(2); expect((await view(id))?.result?.quorumReached).toBe(false);
  });
  it("serializes simultaneous close and vote without changing a published result", async () => {
    const id=await poll(), voter=await member();
    await Promise.allSettled([vote(id,voter),close(id)]);
    const result=(await view(id))!.result;
    expect(result).not.toBeNull();
    await expect(vote(id,voter,"no")).rejects.toMatchObject({code:"closed"});
    expect((await view(id))!.result).toEqual(result);
  });
  it("publishes only question/link, skips an unset route and claims once", async () => {
    const id=await poll(), voter=await member();await vote(id,voter,"no");
    const sent:Array<{text:string;topic:number}>=[];
    const context={database:pool,bot:{send:async(topic:number,text:string)=>{sent.push({topic,text});return 123;},edit:async()=>{}},texts,baseUrl:base,settings:new Map<string,string>()};
    await announcePoll(context,id);expect(sent).toHaveLength(0);
    context.settings.set("topic.veche","12"); await Promise.all([announcePoll(context,id),announcePoll(context,id)]);
    expect(sent).toEqual([{topic:12,text:`${texts["veche.announcement"]}\nSynthetic poll`}]);expect(JSON.stringify(sent)).not.toContain(voter);
  });
  it.skipIf(!http)("actual HTTP API, HTML, RSC, admin and logs keep secret ballots private before/after closure",async()=>{
    const id=await poll(), voter=await member();await vote(id,voter,"no");
    for(const closed of [false,true]) {
      if(closed) await close(id);
      const api=JSON.parse(await request(`/api/veche/${id}`));
      expect(api).not.toHaveProperty("publicVotes");expect(api.result===null).toBe(!closed);
      const payloads=[JSON.stringify(api),await request(`/veche/${id}`),await request(`/veche/${id}`,true),await request("/admin/veche"),await request("/admin/veche",true)];
      for(const payload of payloads) expect(payload).not.toContain(voter);
      expect(serverOutput).not.toContain(voter);
    }
    const outsider=await fetch(base+`/api/veche/${id}`);expect(outsider.status).toBe(401);
  },120000);
  it.skipIf(!http)("actual open-poll API hides running results and POST cannot spoof a voter or disclose a choice",async()=>{
    const id=await poll({mode:"open"}), spoof=await member();
    const response=await fetch(base+`/api/veche/${id}`,{method:"POST",headers:{cookie,origin:base},body:new URLSearchParams({choice:"no",participant_id:spoof}),redirect:"manual"});
    expect(response.status).toBe(303);expect(response.headers.get("location")).not.toContain("choice");
    const running=JSON.parse(await request(`/api/veche/${id}`));expect(running.result).toBeNull();expect(running).not.toHaveProperty("publicVotes");
    expect((await pool.query("SELECT participant_id FROM proposal_votes WHERE proposal_id=$1",[id])).rows).toEqual([{participant_id:author}]);
    const csrf=await fetch(base+`/api/veche/${id}`,{method:"POST",headers:{cookie,origin:"https://other.invalid"},body:new URLSearchParams({choice:"yes"}),redirect:"manual"});expect(csrf.status).toBe(403);
    await close(id);expect(JSON.parse(await request(`/api/veche/${id}`)).publicVotes).toEqual([{participantId:author,displayName:`Private voter ${author}`,choice:"no"}]);
  },60000);
  async function signatureCircle(fraction=0.5, deadline:Date|null=null) {
    const city='Synthetic signature circle '+randomUUID();
    const creator=await member(city), one=await member(city), two=await member(city);
    await saveSignatureSettings(pool,{minimumDao:1,minimumCity:1,fractionDao:fraction,fractionCity:fraction,days:14,cooldownDays:1});
    const config={circle:'city' as const,mode:'secret' as const,deadline};
    const id=(await createSignatureCallWithDatabase(pool,creator,'Synthetic signature poll','Synthetic question',config)).id;
    return {id,creator,one,two,config};
  }
  it('signature defaults require explicit threshold/cooldown; collection defaults to 14 days',async()=>{
    await saveSignatureSettings(pool,{minimumDao:1,minimumCity:1,fractionDao:null,fractionCity:null,days:14,cooldownDays:null});
    expect(await readSignatureSettings(pool)).toEqual({fractionDao:null,fractionCity:null,days:14,cooldownDays:null,minimumDao:1,minimumCity:1});
    await expect(createSignatureCallWithDatabase(pool,author,'Synthetic question','Synthetic body',{circle:'dao',mode:'secret',deadline:null})).rejects.toThrow('Signature settings are not configured');
  });
  it('excludes the author from the signature threshold and opens only on reaching it',async()=>{
    const c=await signatureCircle();
    const initial=(await view(c.id))!;expect(initial.call?.required).toBe(2);expect(initial.call?.population).toBe(3);expect(initial.call?.state).toBe('collecting');
    await setSignatureWithDatabase(pool,c.id,c.creator,true);
    expect((await view(c.id))?.call?.counted).toBe(0);
    await setSignatureWithDatabase(pool,c.id,c.one,true);expect((await view(c.id))?.call?.state).toBe('collecting');
    await expect(vote(c.id,c.one)).rejects.toMatchObject({code:'closed'});
    await expect(pool.query("INSERT INTO proposal_votes(proposal_id,participant_id,choice) VALUES($1,$2,'yes')",[c.id,c.one])).rejects.toThrow('Poll has not been called');
    await setSignatureWithDatabase(pool,c.id,c.two,true);expect((await view(c.id))?.call?.state).toBe('called');
    expect((await view(c.id))?.turnout).toBe(0);await vote(c.id,c.one,'no');expect((await view(c.id))?.turnout).toBe(1);
  });
  it('signatures are public, are not votes, can be withdrawn before call and award nothing',async()=>{
    const c=await signatureCircle();const ledger=(await pool.query('SELECT count(*) AS n FROM darus_ledger')).rows[0].n;
    await setSignatureWithDatabase(pool,c.id,c.one,true);
    expect((await view(c.id))?.call?.signatures.map(s=>s.participantId)).toEqual([c.one]);
    expect((await view(c.id))?.turnout).toBe(0);
    await setSignatureWithDatabase(pool,c.id,c.one,false);expect((await view(c.id))?.call?.signatures).toEqual([]);
    expect((await pool.query('SELECT count(*) AS n FROM darus_ledger')).rows[0].n).toBe(ledger);
  });
  it('refuses out-of-circle, missing-city and former-member signatures',async()=>{
    const c=await signatureCircle();
    for(const id of [await member('Another synthetic place'),await member(null),await member('Synthetic place','left')])
      await expect(setSignatureWithDatabase(pool,c.id,id,true)).rejects.toThrow('Signer is not eligible');
    expect((await view(c.id))?.call?.counted).toBe(0);
  });
  it('DAO signature circle accepts an eligible participant from another city',async()=>{
    await saveSignatureSettings(pool,{minimumDao:1,minimumCity:1,fractionDao:1,fractionCity:0.5,days:14,cooldownDays:1});
    const id=(await createSignatureCallWithDatabase(pool,author,'Synthetic DAO poll','Synthetic question',{circle:'dao',mode:'open',deadline:null})).id;
    const outsider=await member('Another synthetic place');await setSignatureWithDatabase(pool,id,outsider,true);
    expect((await view(id))?.call?.counted).toBe(1);expect((await view(id))?.turnout).toBe(0);
  });
  it('serializes simultaneous threshold signatures, then forbids withdrawal',async()=>{
    const c=await signatureCircle();await Promise.all([c.one,c.two].map(id=>setSignatureWithDatabase(pool,c.id,id,true)));
    expect((await view(c.id))?.call?.state).toBe('called');expect((await view(c.id))?.call?.counted).toBe(2);
    await expect(setSignatureWithDatabase(pool,c.id,c.one,false)).rejects.toMatchObject({code:'closed'});
    await expect(pool.query("UPDATE proposals SET poll_call_state='collecting' WHERE id=$1",[c.id])).rejects.toThrow('Signature call state is immutable');
    await expect(pool.query("UPDATE proposals SET poll_signatures_required=1 WHERE id=$1",[c.id])).rejects.toThrow('Signature configuration is immutable');
  });
  it('expires an uncalled question, enforces same-author same-circle cooldown, and distinguishes DAO/city',async()=>{
    const c=await signatureCircle(0.5,new Date(Date.now()+1600));
    await pool.query('SELECT pg_sleep(1.8)');await refreshSignatureCalls(pool);
    expect((await view(c.id))?.call?.state).toBe('not_called');expect((await view(c.id))?.closedAt).toBeNull();expect((await view(c.id))?.result).toBeNull();
    await expect(createSignatureCallWithDatabase(pool,c.creator,'Any changed question','Synthetic body',{...c.config,deadline:null})).rejects.toThrow('Signature call cooldown has not ended');
    const other=(await createSignatureCallWithDatabase(pool,c.creator,'Other circle','Synthetic body',{circle:'dao',mode:'secret',deadline:null})).id;
    expect((await view(other))?.call?.state).toBe('collecting');
    await saveSignatureSettings(pool,{minimumDao:1,minimumCity:1,fractionDao:0.5,fractionCity:0.5,days:14,cooldownDays:0});
    const retry=(await createSignatureCallWithDatabase(pool,c.creator,'Any question after explicit zero pause','Synthetic body',{...c.config,deadline:null})).id;
    expect((await view(retry))?.call?.state).toBe('collecting');
  },15000);
  it('publishes distinct collection and called notices without ballots and without duplicates',async()=>{
    const c=await signatureCircle();const sent:string[]=[];
    const context={database:pool,bot:{send:async(_topic:number,text:string)=>{sent.push(text);return 123;},edit:async()=>{}},texts,baseUrl:base,settings:new Map([['topic.veche','12']])};
    await announceSignatureCollection(context,c.id);await announceSignatureCollection(context,c.id);await announcePoll(context,c.id);
    expect(sent).toHaveLength(1);expect(sent[0]).toContain(texts['veche.signature_meaning']);
    await setSignatureWithDatabase(pool,c.id,c.one,true);await setSignatureWithDatabase(pool,c.id,c.two,true);await vote(c.id,c.one,'no');
    await Promise.all([announcePoll(context,c.id),announcePoll(context,c.id)]);expect(sent).toHaveLength(2);
    expect(sent[1]).toContain(texts['veche.announcement']);expect(sent.join(' ')).not.toContain(c.one);
  });
  it.skipIf(!http)('HTTP collection displays public support without revealing a secret ballot; create requires session and cannot skip threshold',async()=>{
    const c=await signatureCircle();await setSignatureWithDatabase(pool,c.id,c.one,true);
    const collecting=JSON.parse(await request('/api/veche/'+c.id));expect(collecting.call.signatures[0].participantId).toBe(c.one);expect(collecting.turnout).toBe(0);expect(collecting.result).toBeNull();
    await setSignatureWithDatabase(pool,c.id,c.two,true);
    const privateVoter=await member('Synthetic signature circle '+randomUUID());
    // A legal voter can change residence to the fixed poll city; support and ballot remain different facts.
    const city=(await pool.query('SELECT residence_name FROM participants WHERE id=$1',[c.creator])).rows[0].residence_name;
    await pool.query('UPDATE participants SET residence_name=$2 WHERE id=$1',[privateVoter,city]);await vote(c.id,privateVoter,'no');
    for(const closed of [false,true]){
      if(closed)await closePollWithDatabase(pool,c.id,c.creator);
      for(const payload of [await request('/api/veche/'+c.id),await request('/veche/'+c.id),await request('/veche/'+c.id,true)])expect(payload).not.toContain(privateVoter);
    }
    const unauthorized=await fetch(base+'/api/veche',{method:'POST',body:new URLSearchParams({circle:'dao',mode:'secret',timing:'permanent',title:'Synthetic call',body:'Synthetic body'}),redirect:'manual'});expect(unauthorized.status).toBe(401);
    const response=await fetch(base+'/api/veche',{method:'POST',headers:{cookie,origin:base},body:new URLSearchParams({circle:'dao',mode:'secret',timing:'permanent',title:'Synthetic call',body:'Synthetic body',poll_call_state:'called'}),redirect:'manual'});
    expect(response.status).toBe(303);
    const location=new URL(response.headers.get('location')!);expect(location.pathname.startsWith('/veche/')).toBe(true);
    const created=JSON.parse(await request('/api'+location.pathname));expect(created.call.state).toBe('collecting');expect(created.turnout).toBe(0);
  },120000);
  it('keeps the threshold proof after called signers change membership',async()=>{
    const c=await signatureCircle();await setSignatureWithDatabase(pool,c.id,c.one,true);await setSignatureWithDatabase(pool,c.id,c.two,true);
    await pool.query("UPDATE participants SET membership_status='left' WHERE id=$1",[c.one]);
    expect((await view(c.id))?.call?.counted).toBe(2);expect((await view(c.id))?.call?.state).toBe('called');
    await expect(pool.query('UPDATE proposals SET poll_signature_count_at_call=0 WHERE id=$1',[c.id])).rejects.toThrow('Signature call outcome is immutable');
  });
  it.skipIf(!http)('HTTP admin settings reject ordinary participants and foreign origin before writing',async()=>{
    const ordinary=await member(), token=randomBytes(32).toString('base64url');
    await pool.query("INSERT INTO sessions(token_hash,participant_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),ordinary]);
    const settings=(await pool.query('SELECT row_to_json(s) AS settings FROM veche_settings s')).rows;
    const response=await fetch(base+'/api/admin/veche',{method:'POST',headers:{cookie:'dao_session='+token,origin:base},body:new URLSearchParams({quorumDao:'1'}),redirect:'manual'});
    expect(response.status).toBe(403);
    const csrf=await fetch(base+'/api/admin/veche',{method:'POST',headers:{cookie,origin:'https://foreign.invalid'},body:new URLSearchParams({quorumDao:'1'}),redirect:'manual'});expect(csrf.status).toBe(403);
    const page=await fetch(base+'/admin/veche',{headers:{cookie:'dao_session='+token},redirect:'manual'});expect(page.status).toBe(307);expect(page.headers.get('location')).toContain('/profile');
    expect((await pool.query('SELECT row_to_json(s) AS settings FROM veche_settings s')).rows).toEqual(settings);
  },60000);

  it('adds a migration snapshot to existing collections without rewriting their threshold or deadline',async()=>{
    const row=(await pool.query('SELECT poll_rule_snapshot,poll_signatures_required,poll_signature_deadline FROM proposals WHERE id=$1',[preSnapshotCall])).rows[0];
    expect(row.poll_rule_snapshot).toMatchObject({fraction:0.5,minimum:5,required:preSnapshotRequired,circle:'city',days:14,origin:'migration'});
    expect(Number(row.poll_signatures_required)).toBe(preSnapshotRequired);expect(new Date(row.poll_signature_deadline).toISOString()).toBe(preSnapshotDeadline);
    expect((await view(preSnapshotCall))?.call?.required).toBe(preSnapshotRequired);
  });
  it('uses max(minimum, ceil(fraction*population)) and freezes all collection rules against later settings',async()=>{
    const city='Synthetic minimum circle '+randomUUID(),creator=await member(city);await member(city);await member(city);
    await saveSignatureSettings(pool,{fractionDao:0.1,fractionCity:0.1,days:14,cooldownDays:1,minimumDao:5,minimumCity:5});
    const config={circle:'city' as const,mode:'secret' as const,deadline:null};
    const small=(await createSignatureCallWithDatabase(pool,creator,'Small circle','Synthetic body',config)).id;const before=(await view(small))!.call!;expect(before.required).toBe(5);
    const snapshot=(await pool.query('SELECT poll_rule_snapshot FROM proposals WHERE id=$1',[small])).rows[0].poll_rule_snapshot;expect(snapshot).toMatchObject({fraction:0.1,minimum:5,required:5,population:3,days:14,circle:'city',origin:'creation'});
    await saveSignatureSettings(pool,{fractionDao:0.9,fractionCity:0.9,days:1,cooldownDays:1,minimumDao:1,minimumCity:1});
    const unchanged=(await view(small))!.call!;expect(unchanged.required).toBe(before.required);expect(unchanged.deadline).toBe(before.deadline);
    for(let n=0;n<7;n++)await member(city);
    const large=(await createSignatureCallWithDatabase(pool,creator,'Large circle','Synthetic body',config)).id;expect((await view(large))?.call?.required).toBe(9);
    await expect(pool.query("UPDATE proposals SET poll_rule_snapshot=jsonb_set(poll_rule_snapshot,'{minimum}','1') WHERE id=$1",[small])).rejects.toThrow('Veche rule snapshot is immutable');
  });
  it('keeps anonymous signatures and open ballots free of initiator identity while preserving independent participants',async()=>{
    const c=await signatureCircle(),anonymous=(await createSignatureCallWithDatabase(pool,c.creator,'Anonymous question','Synthetic body',{...c.config,authorVisibility:'anonymous'})).id;
    await setSignatureWithDatabase(pool,anonymous,c.creator,true);await setSignatureWithDatabase(pool,anonymous,c.one,true);await setSignatureWithDatabase(pool,anonymous,c.two,true);
    await vote(anonymous,c.creator);await vote(anonymous,c.one);
    expect((await view(anonymous))?.authorId).toBeNull();expect(JSON.stringify(await view(anonymous))).not.toContain(c.creator);
    expect(await ownProposalFlags(pool,anonymous,c.creator)).toEqual({own:true,signed:true});
    await expect(closePollWithDatabase(pool,anonymous,c.one)).rejects.toMatchObject({code:'forbidden'});await closePollWithDatabase(pool,anonymous,c.creator);
    const event=(await pool.query("SELECT participant_id,payload FROM events WHERE payload->>'proposal_id'=$1",[anonymous])).rows;expect(event[0].participant_id).toBeNull();expect(JSON.stringify(event)).not.toContain(c.creator);
    expect((await listProposalsWithDatabase(pool)).find(row=>row.id===anonymous)?.authorParticipantId).toBeNull();
    await expect(pool.query("UPDATE proposals SET author_visibility='public' WHERE id=$1",[anonymous])).rejects.toThrow('Author visibility is immutable');
    expect((await view(c.id))?.authorId).toBe(c.creator);
    const open=(await createProposalWithDatabase(pool,c.creator,'Anonymous open','Synthetic body',{...c.config,mode:'open',authorVisibility:'anonymous'})).id;
    await vote(open,c.creator,'no');await vote(open,c.one,'yes');await closePollWithDatabase(pool,open,c.creator);
    const result=(await view(open))!;expect(result.publicVotes).toContainEqual({participantId:null,displayName:null,choice:'no'});expect(result.publicVotes).toContainEqual({participantId:c.one,displayName: 'Private voter '+c.one,choice:'yes'});expect(JSON.stringify(result)).not.toContain(c.creator);
  });
  it.skipIf(!http)('anonymous paid initiator is absent from actual API, HTML, RSC, lists, admin, events, announcements, logs and foreign books',async()=>{
    const creator=await member('Synthetic private circle '+randomUUID());
    await pool.query("INSERT INTO darus_ledger(participant_id,amount,reward_rule_id,reward_rule_version,source_type) SELECT $1,amount,id,version,'residence_first_filled' FROM reward_rules WHERE action_type='residence_first_filled' ORDER BY version DESC LIMIT 1",[creator]);
    const client=await pool.connect();try{await client.query('BEGIN');const settings=await readFinanceSettings(client);await saveFinanceSettings(client,author,{...settings,tariffBaseCity:'0.001',tariffMultiplierCity:'1'});await client.query('COMMIT');}finally{client.release();}
    const id=(await createPaidCallWithDatabase(pool,creator,'Anonymous paid question','Synthetic body',{circle:'city',mode:'secret',deadline:null,authorVisibility:'anonymous'})).id;
    const ownBook=await getVisibleDarusBookWithDatabase(pool,creator,creator),foreign=await getVisibleDarusBookWithDatabase(pool,creator,author);
    expect(ownBook.some(row=>row.kind==='hold'&&row.source_id===id)).toBe(true);expect(foreign.some(row=>row.kind==='hold')).toBe(false);expect(JSON.stringify(foreign)).not.toContain(id);
    for(const path of ['/api/veche/'+id,'/veche/'+id,'/veche','/admin/veche']){
     const payloads=[await request(path),...(path.startsWith('/api/')?[]:[await request(path,true)])];
     for(const payload of payloads){expect(payload).not.toContain(creator);expect(payload).not.toContain('Private voter '+creator);expect(payload).not.toContain('/profile/'+creator);}
    }
    const sent:string[]=[];await announcePoll({database:pool,bot:{send:async(_topic:number,text:string)=>{sent.push(text);return 901;},edit:async()=>{}},texts,baseUrl:base,settings:new Map([['topic.veche','12']])},id);expect(JSON.stringify(sent)).not.toContain(creator);
    expect(JSON.stringify((await pool.query("SELECT participant_id,payload FROM events WHERE payload->>'proposal_id'=$1",[id])).rows)).not.toContain(creator);expect(serverOutput).not.toContain(creator);
    const token=randomBytes(32).toString('base64url');await pool.query("INSERT INTO sessions(token_hash,participant_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),creator]);
    const ownPage=await fetch(base+'/veche/'+id,{headers:{cookie:'dao_session='+token}});expect(await ownPage.text()).toContain(texts['veche.own_question']);
    const closeResponse=await fetch(base+'/api/veche/'+id,{method:'POST',headers:{cookie:'dao_session='+token,origin:base},body:new URLSearchParams({action:'close'}),redirect:'manual'});expect(closeResponse.status).toBe(303);expect((await view(id))?.closedAt).not.toBeNull();
    for(const path of ['/api/veche/'+id,'/veche/'+id])expect(await request(path)).not.toContain(creator);
  },120000);

  async function emptyFixture(){
   const creator=await member('Synthetic empty '+randomUUID()),voter=await member();
   const create=(visibility:'public'|'anonymous'='public')=>createProposalWithDatabase(pool,creator,'Synthetic empty question','Synthetic body',{circle:'dao',mode:'secret',deadline:null,authorVisibility:visibility}).then(p=>p.id);
   return {creator,voter,create};
  }
  async function markEmpty(id:string,creator:string,voter:string){await vote(id,voter);await setEmptyMarkWithDatabase(pool,id,voter,true);await closePollWithDatabase(pool,id,creator);expect((await view(id))?.empty.recognized).toBe(true);}
  async function approvedDecision(){const id=await poll({mode:'open'});await vote(id,author);await close(id);return id;}
  it('keeps empty recognition and repetition defaults off and validates optional settings',async()=>{
   expect(await readEmptySettings(pool)).toEqual({emptyFraction:null,emptySignalCount:null,emptySignalDays:null});
   expect(parseEmptySettings({emptyFraction:'',emptySignalCount:'',emptySignalDays:''})).toEqual({emptyFraction:null,emptySignalCount:null,emptySignalDays:null});
   for(const emptyFraction of ['0','1.1','-1','NaN'])expect(()=>parseEmptySettings({emptyFraction,emptySignalCount:null,emptySignalDays:null})).toThrow();
   const c=await emptyFixture(),id=await c.create();await expect(setEmptyMarkWithDatabase(pool,id,c.voter,true)).rejects.toThrow('disabled');
   await saveEmptySettings(pool,{emptyFraction:0.5,emptySignalCount:null,emptySignalDays:null});
  });
  it('excludes the initiator, enforces circle and city, and exposes one withdrawable mark without revealing secret choices',async()=>{
   const c=await emptyFixture(),id=await c.create(),noCity=await member(null),outsider=await member('Synthetic elsewhere');
   await expect(setEmptyMarkWithDatabase(pool,id,c.creator,true)).rejects.toThrow('own poll');await expect(setEmptyMarkWithDatabase(pool,id,noCity,true)).rejects.toThrow('not eligible');
   const city=(await createProposalWithDatabase(pool,c.creator,'City','Body',{circle:'city',mode:'secret',deadline:null})).id;
   await expect(setEmptyMarkWithDatabase(pool,city,outsider,true)).rejects.toThrow('not eligible');
   await Promise.all(Array.from({length:6},()=>setEmptyMarkWithDatabase(pool,id,c.voter,true)));
   expect((await view(id))?.empty.marks).toEqual([{participantId:c.voter,displayName:'Private voter '+c.voter}]);expect((await view(id))?.publicVotes).toBeUndefined();
   await pool.query("UPDATE participants SET membership_status='left' WHERE id=$1",[c.voter]);await setEmptyMarkWithDatabase(pool,id,c.voter,false);expect((await view(id))?.empty.marks).toEqual([]);
  });
  it('freezes the empty result at closure and serializes marks against closure',async()=>{
   const c=await emptyFixture(),id=await c.create();await markEmpty(id,c.creator,c.voter);
   await expect(setEmptyMarkWithDatabase(pool,id,c.voter,false)).rejects.toMatchObject({code:'closed'});
   await expect(pool.query('UPDATE proposals SET poll_empty=false WHERE id=$1',[id])).rejects.toThrow('immutable');
   await saveEmptySettings(pool,{emptyFraction:null,emptySignalCount:null,emptySignalDays:null});expect((await view(id))?.empty.recognized).toBe(true);
   const off=await c.create();await vote(off,c.voter);await closePollWithDatabase(pool,off,c.creator);expect((await view(off))?.empty.recognized).toBe(false);
   await saveEmptySettings(pool,{emptyFraction:0.5,emptySignalCount:null,emptySignalDays:null});
   const race=await c.create();await vote(race,c.voter);
   const [mark]=await Promise.allSettled([setEmptyMarkWithDatabase(pool,race,c.voter,true),closePollWithDatabase(pool,race,c.creator)]);
   const result=(await view(race))!;expect(result.empty.recognized).toBe(mark.status==='fulfilled');expect(result.empty.marks.length).toBe(mark.status==='fulfilled'?1:0);
   const zero=await c.create();await setEmptyMarkWithDatabase(pool,zero,c.voter,true);await closePollWithDatabase(pool,zero,c.creator);expect((await view(zero))?.empty.recognized).toBe(false);
  });
  it('counts only public empty questions and never associates anonymous B with public A in signals or sanctions',async()=>{
   const c=await emptyFixture(),a=await c.create(),b=await c.create('anonymous');await markEmpty(a,c.creator,c.voter);await markEmpty(b,c.creator,c.voter);
   await saveEmptySettings(pool,{emptyFraction:0.5,emptySignalCount:2,emptySignalDays:30});expect((await readEmptySignals(pool)).find(s=>s.authorId===c.creator)).toBeUndefined();
   await saveEmptySettings(pool,{emptyFraction:0.5,emptySignalCount:1,emptySignalDays:30});const signal=(await readEmptySignals(pool)).find(s=>s.authorId===c.creator)!;expect(signal.questions.map(q=>q.id)).toEqual([a]);expect(JSON.stringify(signal)).not.toContain(b);
   const decision=await approvedDecision();await expect(recordFreezeWithDatabase(pool,author,b,decision,'freeze',new Date(Date.now()+60000))).rejects.toThrow('Public empty question');
   await recordFreezeWithDatabase(pool,author,a,decision,'freeze',new Date(Date.now()+60000));const records=await readPublicFreezes(pool);const record=records.find(r=>r.questions.some(q=>q.id===a))!;expect(record.active).toBe(true);expect(record.questions.map(q=>q.id)).toEqual([a]);expect(JSON.stringify(records)).not.toContain(b);
   await recordFreezeWithDatabase(pool,author,a,decision,'unfreeze',null);
  });
  it('requires an approved public open DAO decision, keeps sanctions append-only, blocks all call paths and permits early release',async()=>{
   const c=await emptyFixture(),a=await c.create();await markEmpty(a,c.creator,c.voter);const decision=await approvedDecision();
   await expect(recordFreezeWithDatabase(pool,author,a,'','freeze',new Date(Date.now()+60000))).rejects.toThrow();
   const pending=await poll({mode:'open'});await expect(recordFreezeWithDatabase(pool,author,a,pending,'freeze',new Date(Date.now()+60000))).rejects.toThrow('Closed open DAO decision');
   const rejected=await poll({mode:'open'});await vote(rejected,author,'no');await close(rejected);await expect(recordFreezeWithDatabase(pool,author,a,rejected,'freeze',new Date(Date.now()+60000))).rejects.toThrow('Approved DAO decision');
   const secret=await poll();await vote(secret,author);await close(secret);await expect(recordFreezeWithDatabase(pool,author,a,secret,'freeze',new Date(Date.now()+60000))).rejects.toThrow('Closed open DAO decision');
   const anonymousDecision=await poll({mode:'open',authorVisibility:'anonymous'});await vote(anonymousDecision,author);await close(anonymousDecision);await expect(recordFreezeWithDatabase(pool,author,a,anonymousDecision,'freeze',new Date(Date.now()+60000))).rejects.toThrow('Closed open DAO decision');
   await saveSignatureSettings(pool,{fractionDao:0.000001,fractionCity:0.000001,minimumDao:1,minimumCity:1,days:14,cooldownDays:0});
   const collecting=(await createSignatureCallWithDatabase(pool,c.creator,'Pre-freeze collection','Body',{circle:'dao',mode:'secret',deadline:null})).id;
   await recordFreezeWithDatabase(pool,author,a,decision,'freeze',new Date(Date.now()+60000));
   await expect(c.create()).rejects.toThrow('frozen');await expect(c.create('anonymous')).rejects.toThrow('frozen');
   await expect(createSignatureCallWithDatabase(pool,c.creator,'Q','B',{circle:'dao',mode:'secret',deadline:null})).rejects.toThrow('frozen');
   await expect(createPaidCallWithDatabase(pool,c.creator,'Q','B',{circle:'dao',mode:'secret',deadline:null})).rejects.toThrow('frozen');
   await expect(setSignatureWithDatabase(pool,collecting,c.voter,true)).rejects.toThrow('frozen');
   await expect(pool.query("INSERT INTO proposals(author_participant_id,title,body,status,poll_circle,poll_mode) VALUES($1,'Q','B','open','dao','secret')",[c.creator])).rejects.toThrow('frozen');
   await expect(pool.query('DELETE FROM veche_convocation_freezes WHERE source_proposal_id=$1',[a])).rejects.toThrow('append-only');
   await recordFreezeWithDatabase(pool,author,a,decision,'unfreeze',null);await expect(c.create()).resolves.toBeTypeOf('string');await setSignatureWithDatabase(pool,collecting,c.voter,true);expect((await view(collecting))?.call?.state).toBe('called');
  });
  it('serializes freezes with call creation and allows calls after expiry without rewriting sanctions',async()=>{
   const c=await emptyFixture(),a=await c.create();await markEmpty(a,c.creator,c.voter);const decision=await approvedDecision();
   const lock=await pool.connect();try{
    await lock.query('BEGIN');await lock.query('SELECT id FROM participants WHERE id=$1 FOR UPDATE',[c.creator]);
    const creating=c.create();await recordFreezeWithDatabase(lock,author,a,decision,'freeze',new Date(Date.now()+1200));await lock.query('COMMIT');await expect(creating).rejects.toThrow('frozen');
   }finally{lock.release();}
   await new Promise(resolve=>setTimeout(resolve,1300));await expect(c.create()).resolves.toBeTypeOf('string');
  });
  it.skipIf(!http)('HTTP marks use the session actor, reject CSRF/self marks; sanctions require admin and omit anonymous B from actual admin and RSC projection',async()=>{
   const c=await emptyFixture(),a=await c.create(),b=await c.create('anonymous');
   const token=randomBytes(32).toString('base64url');await pool.query("INSERT INTO sessions(token_hash,participant_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),c.creator]);
   const path='/api/veche/'+a+'/empty';
   expect((await fetch(base+path,{method:'POST',body:new URLSearchParams({mark:'on'}),redirect:'manual'})).status).toBe(401);
   expect((await fetch(base+path,{method:'POST',headers:{cookie,origin:'https://foreign.invalid'},body:new URLSearchParams({mark:'on'}),redirect:'manual'})).status).toBe(403);
   const own=await fetch(base+path,{method:'POST',headers:{cookie:'dao_session='+token,origin:base},body:new URLSearchParams({mark:'on',participantId:c.voter}),redirect:'manual'});expect(own.headers.get('location')).toContain('failed');
   const marked=await fetch(base+path,{method:'POST',headers:{cookie,origin:base},body:new URLSearchParams({mark:'on',participantId:c.creator}),redirect:'manual'});expect(marked.headers.get('location')).toContain('saved');expect((await view(a))?.empty.marks[0].participantId).toBe(author);
   for(const rsc of [false,true]){const payload=await request('/veche/'+a,rsc);expect(payload).toContain(texts['veche.empty_count']);expect(payload).toContain(author);}
   const withdrawn=await fetch(base+path,{method:'POST',headers:{cookie,origin:base},body:new URLSearchParams({mark:'off'}),redirect:'manual'});expect(withdrawn.headers.get('location')).toContain('saved');expect((await view(a))?.empty.marks).toEqual([]);
   await markEmpty(a,c.creator,c.voter);await markEmpty(b,c.creator,c.voter);await saveEmptySettings(pool,{emptyFraction:0.5,emptySignalCount:1,emptySignalDays:30});const decision=await approvedDecision();
   const body=new URLSearchParams({source:a,decision,action:'freeze',expiresAt:new Date(Date.now()+3600000+3*3600000).toISOString().slice(0,16),attest:'yes'});
   expect((await fetch(base+'/api/admin/veche/freeze',{method:'POST',headers:{cookie:'dao_session='+token,origin:base},body,redirect:'manual'})).status).toBe(403);
   expect((await fetch(base+'/api/admin/veche/freeze',{method:'POST',headers:{cookie,origin:'https://foreign.invalid'},body,redirect:'manual'})).status).toBe(403);
   const result=await fetch(base+'/api/admin/veche/freeze',{method:'POST',headers:{cookie,origin:base},body,redirect:'manual'});expect(result.headers.get('location')).toContain('freeze=saved');
   for(const rsc of [false,true]){const payload=await request('/admin/veche',rsc);expect(payload).toContain(a);expect(payload).toContain(decision);expect(payload).not.toContain(b);}
   expect(JSON.stringify(await readEmptySignals(pool))).not.toContain(b);expect(JSON.stringify(await readPublicFreezes(pool))).not.toContain(b);
   for(const rsc of [false,true]){const payload=await request('/veche',rsc);expect(payload).toContain(texts['veche.freeze_active']);}
   const denied=await fetch(base+'/api/veche',{method:'POST',headers:{cookie:'dao_session='+token,origin:base},body:new URLSearchParams({circle:'dao',mode:'secret',timing:'permanent',title:'Q',body:'B',path:'signatures'}),redirect:'manual'});expect(denied.headers.get('location')).toContain('failed');
   expect(await request('/veche',false,{cookie:'dao_session='+token})).not.toContain('action="/api/veche"');
   expect(serverOutput).not.toContain(c.creator);await recordFreezeWithDatabase(pool,author,a,decision,'unfreeze',null);
  },120000);

  it('presentation quotes use the creation snapshot formula and include unaffordable configured tariffs',async()=>{
   const city='Synthetic preview '+randomUUID(),creator=await member(city);await member(city);await member(city);
   await saveSignatureSettings(pool,{fractionDao:0.5,fractionCity:0.5,minimumDao:5,minimumCity:5,days:14,cooldownDays:1});
   const client=await pool.connect();try{await client.query('BEGIN');const settings=await readFinanceSettings(client);await saveFinanceSettings(client,author,{...settings,tariffBaseCity:'0.001',tariffMultiplierCity:'1'});await client.query('COMMIT');}finally{client.release();}
   const availability=await readCallAvailability(pool,creator),quote=availability.quotes.find(q=>q.circle==='city')!;expect(quote).toMatchObject({required:5,population:3,days:14,price:'0.003000',affordable:false});
   const id=(await createSignatureCallWithDatabase(pool,creator,'Preview','Body',{circle:'city',mode:'secret',deadline:null})).id;
   expect((await pool.query('SELECT poll_rule_snapshot FROM proposals WHERE id=$1',[id])).rows[0].poll_rule_snapshot).toMatchObject({required:quote.required,population:quote.population,days:quote.days});
   const noCity=await member(null);expect((await readCallAvailability(pool,noCity)).reason).toBe('city');
  });
  it('menu counts only available unsigned/unvoted questions and owns only the session ballot',async()=>{
   const creator=await member('Synthetic badge '+randomUUID()),voter=await member((await pool.query('SELECT residence_name FROM participants WHERE id=$1',[creator])).rows[0].residence_name);
   const before=await countPendingVecheWithDatabase(pool,voter),id=(await createProposalWithDatabase(pool,creator,'Badge','Body',{circle:'city',mode:'secret',deadline:null})).id;
   expect(await countPendingVecheWithDatabase(pool,voter)).toBe(before+1);await vote(id,voter,'no');expect(await countPendingVecheWithDatabase(pool,voter)).toBe(before);
   expect(await readOwnVote(pool,id,voter)).toBe('no');expect(await readOwnVote(pool,id,creator)).toBeNull();expect(JSON.stringify(await view(id))).not.toContain(voter);
   const collecting=(await createSignatureCallWithDatabase(pool,creator,'Badge signatures','Body',{circle:'city',mode:'secret',deadline:null})).id;
   expect(await countPendingVecheWithDatabase(pool,voter)).toBe(before+1);await setSignatureWithDatabase(pool,collecting,voter,true);expect(await countPendingVecheWithDatabase(pool,voter)).toBe(before);
  });
  it.skipIf(!http)('own secret choice is session-only in actual HTML/RSC, uncached, absent from foreign pages and shared API',async()=>{
   const voter=await member(),id=await poll();await vote(id,voter,'no');const token=randomBytes(32).toString('base64url');await pool.query("INSERT INTO sessions(token_hash,participant_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),voter]);
   const phrase=texts['veche.ui_own_vote'].replace('{choice}',texts['veche.no']);
   for(const closed of [false,true]){
    if(closed)await close(id);
    for(const rsc of [false,true]){
     const own=await request('/veche/'+id,rsc,{cookie:'dao_session='+token});expect(own).toContain(phrase);expect(await request('/veche/'+id,rsc)).not.toContain(phrase);
    }
    const api=await request('/api/veche/'+id,false,{cookie:'dao_session='+token});expect(api).not.toContain(voter);expect(JSON.parse(api)).not.toHaveProperty('ownVote');
   }
   const response=await fetch(base+'/veche/'+id,{headers:{cookie:'dao_session='+token}});expect(response.headers.get('cache-control')).toMatch(/no-store|no-cache/);
  },120000);
  it.skipIf(!http)('six server steps show exact threshold, preserve input and submit through existing API without a stored draft',async()=>{
   await saveSignatureSettings(pool,{fractionDao:0.05,fractionCity:0.05,minimumDao:5,minimumCity:5,days:14,cooldownDays:1});
   const v=wizardValues({title:'Synthetic wizard title',body:'Synthetic wizard body',circle:'dao',mode:'secret',duration:'7',authorVisibility:'public'});
   const before=Number((await pool.query('SELECT count(*) AS n FROM proposals')).rows[0].n);
   for(let step=1;step<=6;step++){const page=await request(wizardHref(v,step));expect(page).toContain(texts['veche.ui_step'].replace('{step}',String(step)));if(step<6)expect(page).toContain('method="get"');}
   expect(Number((await pool.query('SELECT count(*) AS n FROM proposals')).rows[0].n)).toBe(before);
   const quote=(await readCallAvailability(pool,author)).quotes.find(q=>q.circle==='dao')!,review=await request(wizardHref(v,6));
   expect(review).toContain(texts['veche.ui_sign_consequence'].replace('{required}',String(quote.required)).replace('{audience}',texts['veche.ui_signature_audience_dao']).replace('{days}',String(quote.days)));
   const invalid=await fetch(base+wizardHref({...v,title:''},6),{headers:{cookie},redirect:'manual'});expect(invalid.status).toBe(307);expect(new URL(invalid.headers.get('location')!,base).searchParams.get('step')).toBe('1');
   const response=await fetch(base+'/api/veche',{method:'POST',headers:{cookie,origin:base},body:new URLSearchParams({...v,wizard:'yes',path:'signatures'}),redirect:'manual'});expect(response.status).toBe(303);const id=new URL(response.headers.get('location')!).pathname.split('/').at(-1)!;
   expect((await pool.query('SELECT poll_rule_snapshot FROM proposals WHERE id=$1',[id])).rows[0].poll_rule_snapshot).toMatchObject({required:quote.required,days:quote.days,population:quote.population});
   const page=await request('/veche');expect(page).not.toContain('Governance · Proposal v0.1');expect(page).not.toContain('action="/api/proposals"');expect(page).not.toContain(v.body);expect(page).toContain(texts['veche.ui_collecting_group']);
   const collection=await request('/veche/'+id);expect(collection).not.toContain(texts['veche.turnout']+': 0');
   const custom=await request(wizardHref({...v,duration:'custom'},4));expect(custom).toContain('type="datetime-local"');expect(await request(wizardHref(v,4))).not.toContain('type="datetime-local"');
  },120000);
  it.skipIf(!http)('missing city explains all three pages and disables actions while another city retains eligibility text',async()=>{
   await saveSignatureSettings(pool,{fractionDao:0.05,fractionCity:0.05,minimumDao:5,minimumCity:5,days:14,cooldownDays:1});
   await pool.query('UPDATE veche_settings SET empty_fraction=0.5 WHERE singleton');
   const noCity=await member(null),other=await member('Synthetic other locality');
   async function session(id:string){const token=randomBytes(32).toString('base64url');await pool.query("INSERT INTO sessions(token_hash,participant_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),id]);return 'dao_session='+token;}
   const noCityCookie=await session(noCity),otherCookie=await session(other);
   const running=await poll({circle:'city'}),collecting=(await createSignatureCallWithDatabase(pool,author,'Synthetic collection','Synthetic body',{circle:'dao',mode:'secret',deadline:null})).id;
   for(const path of ['/veche','/veche/new','/veche/'+running,'/veche/'+collecting]){
    const html=await request(path,false,{cookie:noCityCookie});expect(html).toContain(texts['veche.missing_city']);expect(html).toContain('href="/profile#residence-name"');expect(html).toContain(texts['veche.specify_city']);expect(html).not.toContain(texts['veche.ineligible']);
    expect(html).not.toMatch(/<form[^>]*action="\/api\/veche/);
    if(path==='/veche')expect(html).toMatch(/<button[^>]*disabled[^>]*>Созвать вече<\/button>/);
   }
   const profile=await request('/profile',false,{cookie:noCityCookie});expect(profile).toContain('id="residence-name"');
   const outside=await request('/veche/'+running,false,{cookie:otherCookie});expect(outside).toContain(texts['veche.ineligible']);expect(outside).not.toContain(texts['veche.missing_city']);
   await vote(running,author);await close(running);
   const result=await request('/veche/'+running,false,{cookie:noCityCookie});expect(result.replace(/<!--.*?-->/g,'')).toContain('100%');expect(result).toContain('Synthetic question');
  },120000);

});
