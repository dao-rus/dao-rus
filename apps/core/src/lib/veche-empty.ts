import { VecheError, validPollId } from "./veche-polls";
import type { ProposalDatabase, ProposalDatabaseClient } from "./proposals";
type Reader = { query: ProposalDatabaseClient["query"] };
export type EmptySettings = { emptyFraction: number | null; emptySignalCount: number | null; emptySignalDays: number | null };
export function parseEmptySettings(values: Record<keyof EmptySettings,unknown>): EmptySettings {
 const optional = (value:unknown,maximum:number,fraction=false) => {
  const raw=String(value??"").trim();if(!raw)return null;
  if(!(fraction?/^(?:0\.\d{1,6}|1(?:\.0{1,6})?)$/:/^\d{1,10}$/).test(raw)||Number(raw)<=0||Number(raw)>maximum)throw new VecheError("invalid");
  return Number(raw);
 };
 return {emptyFraction:optional(values.emptyFraction,1,true),emptySignalCount:optional(values.emptySignalCount,2147483647),emptySignalDays:optional(values.emptySignalDays,36500)};
}
export async function readEmptySettings(db:Reader):Promise<EmptySettings>{
 const s=(await db.query("SELECT empty_fraction,empty_signal_count,empty_signal_days FROM veche_settings WHERE singleton")).rows[0];
 return {emptyFraction:s.empty_fraction===null?null:Number(s.empty_fraction),emptySignalCount:s.empty_signal_count===null?null:Number(s.empty_signal_count),emptySignalDays:s.empty_signal_days===null?null:Number(s.empty_signal_days)};
}
export async function saveEmptySettings(db:Reader,settings:EmptySettings){
 const s=parseEmptySettings(settings);await db.query("UPDATE veche_settings SET empty_fraction=$1,empty_signal_count=$2,empty_signal_days=$3 WHERE singleton",[s.emptyFraction,s.emptySignalCount,s.emptySignalDays]);
}
export async function setEmptyMarkWithDatabase(db:ProposalDatabase,id:string,actor:string,marked:boolean){
 if(!validPollId(id))throw new VecheError("invalid");
 const client=await db.connect();let blocked=false;
 try{
  await client.query("BEGIN");await client.query("SELECT veche_refresh_call($1)",[id]);
  const p=(await client.query("SELECT poll_call_state FROM proposals WHERE id=$1 FOR UPDATE",[id])).rows[0];
  if(!p)throw new VecheError("missing");
  if(!p.poll_call_state||p.poll_call_state==='called')await client.query("SELECT veche_close_poll($1)",[id]);
  const state=(await client.query("SELECT poll_closed_at,poll_call_state FROM proposals WHERE id=$1",[id])).rows[0];
  blocked=Boolean(state.poll_closed_at)||['collecting','not_called'].includes(String(state.poll_call_state));
  if(!blocked){
   if(marked)await client.query("INSERT INTO proposal_empty_marks(proposal_id,participant_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[id,actor]);
   else await client.query("DELETE FROM proposal_empty_marks WHERE proposal_id=$1 AND participant_id=$2",[id,actor]);
  }
  await client.query("COMMIT");
 }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
 if(blocked)throw new VecheError("closed");
}
export async function setEmptyMark(id:string,actor:string,marked:boolean){const {pool}=await import('./db');return setEmptyMarkWithDatabase(pool,id,actor,marked);}
export type PublicEmptyQuestion={id:string;title:string};
export type EmptySignal={authorId:string;displayName:string;questions:PublicEmptyQuestion[]};
// Filter visibility BEFORE grouping. This query never collects anonymous questions.
export async function readEmptySignals(db:Reader):Promise<EmptySignal[]>{
 const rows=(await db.query(`SELECT p.author_participant_id,p2.display_name,json_agg(json_build_object('id',p.id,'title',p.title) ORDER BY p.poll_closed_at,p.id) AS questions
 FROM proposals p JOIN participants p2 ON p2.id=p.author_participant_id CROSS JOIN veche_settings s
 WHERE s.empty_signal_count IS NOT NULL AND s.empty_signal_days IS NOT NULL
 AND p.author_visibility='public' AND p.poll_empty AND p.poll_closed_at>=clock_timestamp()-make_interval(days=>s.empty_signal_days)
 GROUP BY p.author_participant_id,p2.display_name,s.empty_signal_count HAVING count(*)>=s.empty_signal_count ORDER BY p.author_participant_id`)).rows;
 return rows.map(row=>({authorId:String(row.author_participant_id),displayName:String(row.display_name),questions:row.questions as PublicEmptyQuestion[]}));
}
export type PublicFreeze={id:string;action:'freeze'|'unfreeze';active:boolean;expiresAt:string|null;createdAt:string;decision:PublicEmptyQuestion;questions:PublicEmptyQuestion[]};
export async function readPublicFreezes(db:Reader):Promise<PublicFreeze[]>{
 const rows=(await db.query(`SELECT f.id,f.action,f.expires_at,f.created_at,d.id AS decision_id,d.title AS decision_title,
 f.id=(SELECT latest.id FROM veche_convocation_freezes latest JOIN proposals lp ON lp.id=latest.source_proposal_id
 WHERE lp.author_participant_id=p.author_participant_id AND lp.author_visibility='public' AND lp.poll_empty ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
 AND f.action='freeze' AND f.expires_at>clock_timestamp() AS active,
 (SELECT json_agg(json_build_object('id',q.id,'title',q.title) ORDER BY q.poll_closed_at,q.id) FROM proposals q
 WHERE q.author_participant_id=p.author_participant_id AND q.author_visibility='public' AND q.poll_empty AND q.poll_closed_at<=f.created_at) AS questions
 FROM veche_convocation_freezes f JOIN proposals p ON p.id=f.source_proposal_id JOIN proposals d ON d.id=f.decision_proposal_id
 WHERE p.author_visibility='public' AND p.poll_empty ORDER BY f.created_at DESC,f.id DESC`)).rows;
 return rows.map(row=>({id:String(row.id),action:row.action as PublicFreeze['action'],active:row.active===true,expiresAt:row.expires_at?new Date(String(row.expires_at)).toISOString():null,createdAt:new Date(String(row.created_at)).toISOString(),decision:{id:String(row.decision_id),title:String(row.decision_title)},questions:row.questions as PublicEmptyQuestion[]}));
}
// The administrator attests that this approved question actually authorizes the recorded sanction.
export async function recordFreezeWithDatabase(db:Reader,actor:string,source:string,decision:string,action:unknown,expires:Date|null){
 if(!validPollId(source)||!validPollId(decision)||!['freeze','unfreeze'].includes(String(action))||
  (action==='freeze'&&(!expires||!Number.isFinite(expires.getTime())||expires.getTime()<=Date.now()))||
  (action==='unfreeze'&&expires!==null))throw new VecheError('invalid');
 await db.query("INSERT INTO veche_convocation_freezes(source_proposal_id,decision_proposal_id,action,expires_at,actor_id) VALUES($1,$2,$3,$4,$5)",[source,decision,action,expires,actor]);
}
