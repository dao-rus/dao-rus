import { createSignatureCallWithDatabase,saveSignatureSettings,setSignatureWithDatabase } from "./veche-signatures";
import { randomUUID } from "node:crypto";
import { readFileSync,readdirSync } from "node:fs";
import { Pool } from "pg";
import { beforeAll,afterAll,describe,it,expect } from "vitest";
import { createPaidCallWithDatabase,paidCallPrices,saveFinanceSettings,readFinanceSettings,settleDueVeche } from "./veche-finance";
import { createProposalWithDatabase } from "./proposals";
import { castVoteWithDatabase,closePollWithDatabase,getPollViewWithDatabase } from "./veche-polls";
const url=process.env.VECHE_TEST_DATABASE_URL;
const schema=`veche_finance_test_${randomUUID().replaceAll('-','')}`;
const pool=new Pool({connectionString:url,options:`-c search_path=${schema},public`,max:12});
let created=false;
async function member(city:string){const id=randomUUID();await pool.query("INSERT INTO participants(id,display_name,membership_status,residence_name,residence_type,residence_country) VALUES($1,'Synthetic participant','participant',$2,'city','Synthetic country')",[id,city]);return id;}
async function fixture(){
 const city=`Synthetic ${randomUUID()}`,author=await member(city),voters=await Promise.all([member(city),member(city),member(city)]);
 const client=await pool.connect();try{await client.query('BEGIN');await saveFinanceSettings(client,author,{tariffBaseDao:null,tariffBaseCity:'0.000001',tariffMultiplierDao:null,tariffMultiplierCity:'1',attentionDays:'7',organizerFraction:null,organizerCooldownDays:null,participationAmount:'0',organizerAmount:'0'});await client.query('COMMIT');}finally{client.release();}
 await pool.query("INSERT INTO darus_ledger(participant_id,amount,reward_rule_id,reward_rule_version,source_type) SELECT $1,amount,id,version,'residence_first_filled' FROM reward_rules WHERE action_type='residence_first_filled' ORDER BY version DESC LIMIT 1",[author]);
 return {author,voters,city};
}
async function paid(author:string,deadline:Date|null=null){return (await createPaidCallWithDatabase(pool,author,'Synthetic question','Synthetic body',{circle:'city',mode:'secret',deadline})).id;}
async function expireWindow(id:string){
 // Test-clock fixture only; production snapshots remain append-only.
 await pool.query('ALTER TABLE veche_finance DISABLE TRIGGER veche_finance_append_only');
 try{await pool.query("UPDATE veche_finance SET started_at=clock_timestamp()-interval '8 days' WHERE proposal_id=$1",[id]);}finally{await pool.query('ALTER TABLE veche_finance ENABLE TRIGGER veche_finance_append_only');}
 await pool.query('ALTER TABLE proposal_votes DISABLE TRIGGER proposal_votes_guard');
 try{await pool.query("UPDATE proposal_votes SET created_at=clock_timestamp()-interval '2 days' WHERE proposal_id=$1",[id]);}finally{await pool.query('ALTER TABLE proposal_votes ENABLE TRIGGER proposal_votes_guard');}
}
const vote=(id:string,voter:string,choice='abstain')=>castVoteWithDatabase(pool,id,voter,choice);
const balance=async(id:string)=>Number((await pool.query('SELECT coalesce(sum(amount),0) AS n FROM darus_book WHERE participant_id=$1',[id])).rows[0].n);
describe.skipIf(!url)('Veche money on isolated PostgreSQL',()=>{
 beforeAll(async()=>{const parsed=new URL(url!);if(parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/veche_tests')throw Error('Use isolated local veche_tests');await pool.query(`CREATE SCHEMA ${schema}`);created=true;const dir=new URL('../../migrations/',import.meta.url);for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()){
 if(f.startsWith("048_")){const id=await member(`Synthetic legacy ${randomUUID()}`);await pool.query("INSERT INTO darus_ledger(participant_id,amount,reward_rule_id,reward_rule_version,source_type) SELECT $1,amount,id,version,'residence_first_filled' FROM reward_rules WHERE action_type='residence_first_filled' ORDER BY version DESC LIMIT 1",[id]);}
 const before=(await pool.query("SELECT to_regclass('darus_ledger') AS ledger")).rows[0].ledger ? (await pool.query("SELECT * FROM darus_ledger ORDER BY id")).rows:null;
 await pool.query('BEGIN;'+readFileSync(new URL(f,dir),'utf8')+';COMMIT;');
 if(f.startsWith("048_"))expect((await pool.query("SELECT id,participant_id,amount,currency,reward_rule_id,reward_rule_version,source_type,source_attestation_id,source_subject_id,created_at FROM darus_ledger ORDER BY id")).rows).toEqual(before);
 }},60000);
 afterAll(async()=>{if(created)await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();});
 it('keeps defaults disabled and snapshots append-only',async()=>{
  const settings=await readFinanceSettings(pool);expect(settings).toMatchObject({tariffBaseDao:null,tariffBaseCity:null,participationAmount:'0',organizerAmount:'0',attentionDays:'7'});
  const author=await member(`Synthetic ${randomUUID()}`);await expect(paid(author)).rejects.toThrow('Paid call is disabled');expect(await paidCallPrices(pool,author)).toEqual({});
  const id=(await createProposalWithDatabase(pool,author,'Q','B',{circle:'city',mode:'secret',deadline:null})).id;
  await expect(pool.query('UPDATE veche_finance SET population=0 WHERE proposal_id=$1',[id])).rejects.toThrow('append-only');
 });
 it('debits the actual circle quote, excludes unaffordable paths and rolls back insufficient funds',async()=>{
  const {author,voters}=await fixture();expect(await paidCallPrices(pool,author)).toEqual({city:'0.000004'});const before=await balance(author),id=await paid(author);
  expect(await balance(author)).toBeCloseTo(before-.000004,6);
  expect(await paidCallPrices(pool,voters[0])).toEqual({});await expect(paid(voters[0])).rejects.toThrow('Insufficient DARUS balance');
  expect((await pool.query("SELECT count(*) AS n FROM proposals WHERE author_participant_id=$1",[voters[0]])).rows[0].n).toBe('0');
  expect((await pool.query('SELECT amount FROM darus_holds WHERE source_id=$1',[id])).rows[0].amount).toBe('0.000004');
  await expect(pool.query("INSERT INTO darus_movements(participant_id,hold_id,kind,amount,source_type,source_id) SELECT $1,id,'refund',amount,'test.refund',source_id FROM darus_holds WHERE source_id=$2",[author,id])).rejects.toThrow('non-refundable');
 });
 it('serializes simultaneous paid calls without overdrawing the balance',async()=>{
  const {author}=await fixture();await pool.query("UPDATE veche_settings SET tariff_base_city='0.015' WHERE singleton");
  const results=await Promise.allSettled([paid(author),paid(author)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await balance(author)).toBeGreaterThanOrEqual(0);
 });
 it('distributes every micro-unit in first-vote order, including abstention, exactly once',async()=>{
  const {author,voters}=await fixture(),id=await paid(author);for(const voter of voters)await vote(id,voter);
  await vote(id,voters[0],'no');await closePollWithDatabase(pool,id,author); // permanent window is still open: no early distribution
  expect((await pool.query("SELECT count(*) AS n FROM darus_movements WHERE source_id=$1 AND kind='distribution'",[id])).rows[0].n).toBe('0');
  await expireWindow(id);await Promise.all(Array.from({length:6},()=>pool.query('SELECT veche_settle($1)',[id])));
  const rows=(await pool.query("SELECT participant_id,amount FROM darus_movements WHERE source_id=$1 AND kind='distribution' ORDER BY amount DESC,participant_id",[id])).rows;
  expect(rows).toHaveLength(3);expect(rows[0]).toEqual({participant_id:voters[0],amount:'0.000002'});expect(rows.slice(1).map(r=>r.amount)).toEqual(['0.000001','0.000001']);
  expect((await pool.query('SELECT sum(amount) AS n FROM darus_movements WHERE hold_id=(SELECT id FROM darus_holds WHERE source_id=$1)',[id])).rows[0].n).toBe('0.000000');
 });
 it('leaves a zero-turnout tariff spent, with no refund and no mint',async()=>{
  const {author}=await fixture(),id=await paid(author),before=await balance(author);await closePollWithDatabase(pool,id,author);await expireWindow(id);await settleDueVeche(pool);
  expect(await balance(author)).toBe(before);expect((await pool.query("SELECT count(*) AS n FROM darus_movements WHERE source_id=$1 AND kind<>'hold'",[id])).rows[0].n).toBe('0');
  expect((await pool.query('SELECT count(*) AS n FROM darus_ledger WHERE source_proposal_id=$1',[id])).rows[0].n).toBe('0');
 });
 it('excludes late first votes from a permanent window and does not leak choices',async()=>{
  const {author,voters}=await fixture(),id=await paid(author);await vote(id,voters[0]);await expireWindow(id);await vote(id,voters[1],'yes');await settleDueVeche(pool);
  // The first vote is within the simulated week; the later first vote is outside.
  expect((await pool.query("SELECT participant_id,amount FROM darus_movements WHERE source_id=$1 AND kind='distribution'",[id])).rows).toEqual([{participant_id:voters[0],amount:'0.000004'}]);
  expect(JSON.stringify(await getPollViewWithDatabase(pool,id))).not.toContain(voters[1]);
 });
 it('mints a frozen reward-rule version only at quorum, identically for service/signature foundation and paid polls',async()=>{
  const {author,voters}=await fixture();const client=await pool.connect();try{await client.query('BEGIN');const s=await readFinanceSettings(client);await saveFinanceSettings(client,author,{...s,participationAmount:'0.003'});await client.query('COMMIT');}finally{client.release();}
  await pool.query('UPDATE veche_settings SET quorum_city=0.5 WHERE singleton');
  const ids=[await paid(author),(await createProposalWithDatabase(pool,author,'Q','B',{circle:'city',mode:'secret',deadline:null})).id,await paid(author)];
  for(const id of ids.slice(0,2)){await vote(id,voters[0]);await vote(id,voters[1]);}await vote(ids[2],voters[0]);
  for(const id of ids)await closePollWithDatabase(pool,id,author);
  for(const id of ids.slice(0,2))expect((await pool.query("SELECT amount FROM darus_ledger WHERE source_proposal_id=$1 AND source_type='veche_participation'",[id])).rows.map(r=>r.amount)).toEqual(['0.003000','0.003000']);
  expect((await pool.query('SELECT count(*) AS n FROM darus_ledger WHERE source_proposal_id=$1',[ids[2]])).rows[0].n).toBe('0');
  await pool.query('UPDATE veche_settings SET quorum_city=0 WHERE singleton');
 });
 it('mints the same public-good reward after a signature call, with no tariff',async()=>{
  const {author,voters}=await fixture(),client=await pool.connect();try{await client.query('BEGIN');const settings=await readFinanceSettings(client);await saveFinanceSettings(client,author,{...settings,participationAmount:'0.003'});await saveSignatureSettings(client,{fractionDao:null,fractionCity:0.5,days:14,cooldownDays:0});await client.query('COMMIT');}finally{client.release();}
  const id=(await createSignatureCallWithDatabase(pool,author,'Q','B',{circle:'city',mode:'secret',deadline:null})).id;
  await setSignatureWithDatabase(pool,id,voters[0],true);await setSignatureWithDatabase(pool,id,voters[1],true);
  for(const voter of voters.slice(0,2))await vote(id,voter);await closePollWithDatabase(pool,id,author);
  expect((await pool.query("SELECT amount FROM darus_ledger WHERE source_proposal_id=$1 AND source_type='veche_participation'",[id])).rows.map(r=>r.amount)).toEqual(['0.003000','0.003000']);
  expect((await pool.query('SELECT hold_id FROM veche_finance WHERE proposal_id=$1',[id])).rows[0].hold_id).toBeNull();
 });
 it('settles a dated poll on closure and retains the reward version captured at creation',async()=>{
  const {author,voters}=await fixture(),client=await pool.connect();try{await client.query('BEGIN');const settings=await readFinanceSettings(client);await saveFinanceSettings(client,author,{...settings,participationAmount:'0.004'});await client.query('COMMIT');}finally{client.release();}
  const id=await paid(author,new Date(Date.now()+1800));await vote(id,voters[0]);
  const change=await pool.connect();try{await change.query('BEGIN');const settings=await readFinanceSettings(change);await saveFinanceSettings(change,author,{...settings,participationAmount:'0.005'});await change.query('COMMIT');}finally{change.release();}
  await new Promise(resolve=>setTimeout(resolve,1900));await getPollViewWithDatabase(pool,id);await pool.query('SELECT veche_settle($1)',[id]);
  expect((await pool.query("SELECT amount FROM darus_movements WHERE source_id=$1 AND kind='distribution'",[id])).rows).toEqual([{amount:'0.000004'}]);
  expect((await pool.query("SELECT amount FROM darus_ledger WHERE source_proposal_id=$1 AND source_type='veche_participation'",[id])).rows).toEqual([{amount:'0.004000'}]);
 },10000);
 it('serializes the organizer cooldown across different poll closures',async()=>{
  const {author,voters}=await fixture(),client=await pool.connect();try{await client.query('BEGIN');const s=await readFinanceSettings(client);await saveFinanceSettings(client,author,{...s,organizerAmount:'0.002',organizerFraction:'0.000001',organizerCooldownDays:'1'});await client.query('COMMIT');}finally{client.release();}
  const ids=[await paid(author),await paid(author)];for(const id of ids)await vote(id,voters[0]);
  await Promise.all(ids.map(id=>closePollWithDatabase(pool,id,author)));
  expect((await pool.query("SELECT count(*) AS n FROM darus_ledger WHERE participant_id=$1 AND source_type='veche_organizer'",[author])).rows[0].n).toBe('1');
 });
});
