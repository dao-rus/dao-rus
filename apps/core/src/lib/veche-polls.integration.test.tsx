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
let cookie: string;
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
    await pool.query(`CREATE SCHEMA ${schema}`); schemaCreated = true;
    const directory = new URL("../../migrations/", import.meta.url);
    for (const file of readdirSync(directory).filter(name => name.endsWith(".sql") && name < "046_").sort()) await pool.query("BEGIN;" + readFileSync(new URL(file,directory),"utf8") + ";COMMIT;");
    author = await member(); legacy = (await createProposalWithDatabase(pool,author,"Legacy question","Legacy body")).id;
    const before = (await pool.query("SELECT id,title,body,status,created_at FROM proposals ORDER BY id")).rows;
    await pool.query("BEGIN;" + readFileSync(new URL("046_veche_opinion_polls.sql",directory),"utf8") + ";COMMIT;");
    expect((await pool.query("SELECT id,title,body,status,created_at FROM proposals ORDER BY id")).rows).toEqual(before);
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
  afterAll(async () => {
    if (server && server.exitCode===null && server.pid) {
      if (process.platform==="win32") execFileSync("taskkill",["/PID",String(server.pid),"/T","/F"],{ windowsHide:true,stdio:"ignore" });
      else server.kill("SIGTERM");
    }
    if(schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
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
});
