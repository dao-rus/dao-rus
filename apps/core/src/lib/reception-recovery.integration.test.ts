import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {Pool} from "pg";
import {afterAll,beforeAll,beforeEach,describe,it,expect,vi} from "vitest";
import {recoverReceptionDelivery,type RecoveryRow} from "./reception-recovery";
import type {ReceptionRelayBot} from "./telegram-reception-relay";
import {ensureTestPgcrypto} from "./test-postgres-extensions";
vi.mock('./config',()=>({telegramReceptionConfig:()=>({token:'synthetic',forumChatId:'-100123',topicId:'1'})}));
const databaseUrl=process.env.RECEPTION_TEST_DATABASE_URL,schema='reception_test_'+randomUUID().replaceAll('-','');
const db=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema},public`,max:6});let created=false;
const bot=():ReceptionRelayBot=>({sendAttribution:vi.fn(async()=>({status:'sent' as const,messageId:100})),copyMessage:vi.fn(async()=>({status:'sent' as const,messageId:101}))});
async function entry(id:number,code='telegram_400',direction='private_to_forum',status='failed'){
 await db.query(`INSERT INTO reception_relay_updates(update_id,direction,forum_chat_id,private_chat_id,private_message_id,forum_message_id,status,error_code,updated_at)
 VALUES($1,$2,-100123,42,$3,$4,$5,$6,now()-interval '2 minutes')`,[id,direction,direction==='private_to_forum'?11:null,direction==='forum_to_private'?12:null,status,code]);
 return (await db.query('SELECT *,updated_at::text AS recovery_version FROM reception_relay_updates WHERE update_id=$1',[id])).rows[0] as RecoveryRow;
}
describe.skipIf(!databaseUrl)('Reception recovery on isolated PostgreSQL',()=>{
 beforeAll(async()=>{const u=new URL(databaseUrl!);if(u.hostname!=='127.0.0.1'||u.pathname!=='/reception_tests')throw new Error('Use isolated local reception_tests');await db.query(`CREATE SCHEMA ${schema}`);created=true;await ensureTestPgcrypto(db);
 for(const file of ['025_reception_relay.sql','040_reception_heading.sql'])await db.query(readFileSync(new URL('../../migrations/'+file,import.meta.url),'utf8'));});
 beforeEach(async()=>{await db.query('TRUNCATE reception_relay_updates');});
 afterAll(async()=>{if(created)await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end();});
 it('claims deterministic failures once under concurrency and keeps webhook idempotency',async()=>{
  const row=await entry(1),b=bot();const results=await Promise.all(Array.from({length:8},()=>recoverReceptionDelivery(row,db,{senderLabel:'Synthetic applicant'},b)));
  expect(results.filter(x=>x==='sent')).toHaveLength(1);expect(b.copyMessage).toHaveBeenCalledTimes(1);expect(b.sendAttribution).toHaveBeenCalledTimes(1);
  const saved=(await db.query('SELECT *,updated_at::text AS recovery_version FROM reception_relay_updates WHERE update_id=1')).rows[0];expect(saved).toMatchObject({status:'sent',error_code:null,forum_message_id:'101',forum_heading_message_id:'100'});
  expect(await recoverReceptionDelivery(saved,db,{},b)).toBe('not_recoverable');
  const duplicate=await db.query(`INSERT INTO reception_relay_updates(update_id,direction,forum_chat_id,private_chat_id,status) VALUES(1,'private_to_forum',-100123,42,'pending') ON CONFLICT(update_id) DO NOTHING RETURNING update_id`);expect(duplicate.rowCount).toBe(0);
 });
 it.each([[10,'network_or_timeout'],[11,'telegram_500'],[12,'invalid_response'],[13,'recovery_in_progress']] as const)('refuses ambiguous %s %s without human verification',async (id,code)=>{
  const row=await entry(id,code),b=bot();await expect(recoverReceptionDelivery(row,db,{senderLabel:'Synthetic'},b)).rejects.toThrow('confirm absence');expect(b.copyMessage).not.toHaveBeenCalled();
 });
 it('refuses pending entries and active attempts unless reviewed',async()=>{
  const row=await entry(2,'network_or_timeout','forum_to_private','pending'),b=bot();await expect(recoverReceptionDelivery(row,db,{},b)).rejects.toThrow('confirm absence');
  await expect(recoverReceptionDelivery({...row,updated_at:new Date()},db,{confirmedNotDelivered:true},b)).rejects.toThrow('still be active');
 });
 it('recovers an explicitly checked forum reply and maps the actual private message',async()=>{
  const row=await entry(3,'network_or_timeout','forum_to_private'),b=bot();expect(await recoverReceptionDelivery(row,db,{confirmedNotDelivered:true},b)).toBe('sent');
  expect(b.copyMessage).toHaveBeenCalledWith({chatId:'42',fromChatId:'-100123',messageId:12});expect(b.sendAttribution).not.toHaveBeenCalled();
  expect((await db.query('SELECT status,private_message_id FROM reception_relay_updates WHERE update_id=3')).rows[0]).toEqual({status:'sent',private_message_id:'101'});
 });
 it('preserves a successful heading after copy failure and reuses it on reviewed recovery',async()=>{
  const row=await entry(4),b=bot();vi.mocked(b.copyMessage).mockResolvedValueOnce({status:'failed',errorCode:'network_or_timeout'});
  expect(await recoverReceptionDelivery(row,db,{senderLabel:'Synthetic'},b)).toBe('failed');
  const saved=(await db.query('SELECT *,updated_at::text AS recovery_version FROM reception_relay_updates WHERE update_id=4')).rows[0];expect(saved.forum_heading_message_id).toBe('100');
  expect(await recoverReceptionDelivery({...saved,updated_at:row.updated_at,recovery_version:row.recovery_version},db,{confirmedNotDelivered:true},b)).toBe('already_claimed');
  await db.query("UPDATE reception_relay_updates SET updated_at=now()-interval '2 minutes' WHERE update_id=4");
  const retry=(await db.query('SELECT *,updated_at::text AS recovery_version FROM reception_relay_updates WHERE update_id=4')).rows[0];expect(await recoverReceptionDelivery(retry,db,{confirmedNotDelivered:true},b)).toBe('sent');expect(b.sendAttribution).toHaveBeenCalledTimes(1);
 });
 it('does not report sent when Telegram accepted but the DB mapping was not saved',async()=>{
  const row=await entry(6,'telegram_400','forum_to_private'),b=bot();
  const database={query:async(sql:string,values?:unknown[])=>sql.includes("SET status='sent'")?{rowCount:0,rows:[]}:db.query(sql,values)};
  await expect(recoverReceptionDelivery(row,database,{},b)).rejects.toThrow('Telegram accepted');
  expect(b.copyMessage).toHaveBeenCalledTimes(1);expect((await db.query('SELECT status FROM reception_relay_updates WHERE update_id=6')).rows[0].status).toBe('pending');
 });
 it('respects retry_after, configured forum and missing source',async()=>{
  const row=await entry(5,'telegram_429_retry_after_300'),b=bot();await expect(recoverReceptionDelivery(row,db,{senderLabel:'Synthetic'},b)).rejects.toThrow('retry_after');
  await expect(recoverReceptionDelivery({...row,forum_chat_id:'-999'},db,{},b)).rejects.toThrow('target');
  await expect(recoverReceptionDelivery({...row,error_code:'telegram_400',private_message_id:null},db,{},b)).rejects.toThrow('sender must resend');
 });
});
