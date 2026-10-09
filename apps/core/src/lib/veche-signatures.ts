import type { ProposalDatabase, ProposalDatabaseClient } from "./proposals";
import { createProposalWithDatabase } from "./proposals";
import { normalizePollConfig, validPollId, VecheError, type PollConfig } from "./veche-polls";
export type SignatureSettings = { fractionDao: number | null; fractionCity: number | null; days: number; cooldownDays: number | null; minimumDao?: number; minimumCity?: number };
type Reader = Pick<ProposalDatabaseClient,"query">;
export async function readSignatureSettings(database: Reader): Promise<SignatureSettings> {
  const row=(await database.query("SELECT signature_fraction_dao,signature_fraction_city,signature_days,signature_cooldown_days,signature_minimum_dao,signature_minimum_city FROM veche_settings WHERE singleton")).rows[0];
  return { fractionDao:row.signature_fraction_dao===null?null:Number(row.signature_fraction_dao),fractionCity:row.signature_fraction_city===null?null:Number(row.signature_fraction_city),days:Number(row.signature_days),cooldownDays:row.signature_cooldown_days===null?null:Number(row.signature_cooldown_days),minimumDao:Number(row.signature_minimum_dao),minimumCity:Number(row.signature_minimum_city) };
}
export function parseSignatureSettings(input:{fractionDao:unknown;fractionCity:unknown;days:unknown;cooldownDays:unknown;minimumDao?:unknown;minimumCity?:unknown}): SignatureSettings {
  const fraction=(value:unknown)=>{ const text=String(value??"").trim(); if(!text) return null;
    if(!/^(?:0\.\d{1,6}|1(?:\.0{1,6})?)$/.test(text)||Number(text)<=0)throw new VecheError("invalid");return Number(text); };
  const integer=(value:unknown,minimum:number,optional:boolean)=>{const text=String(value??"").trim();if(optional&&!text)return null;
    if(!/^\d{1,5}$/.test(text)||Number(text)<minimum||Number(text)>36500)throw new VecheError("invalid");return Number(text);};
  const minimum=(value:unknown)=>{const text=String(value??5);if(!/^\d{1,10}$/.test(text)||Number(text)<1||Number(text)>2147483647)throw new VecheError("invalid");return Number(text);};
  return {minimumDao:minimum(input.minimumDao),minimumCity:minimum(input.minimumCity),fractionDao:fraction(input.fractionDao),fractionCity:fraction(input.fractionCity),days:integer(input.days,1,false)!,cooldownDays:integer(input.cooldownDays,0,true)};
}
export async function saveSignatureSettings(database: Reader, input: SignatureSettings) {
  const settings=parseSignatureSettings(input);
  await database.query("UPDATE veche_settings SET signature_fraction_dao=$1,signature_fraction_city=$2,signature_days=$3,signature_cooldown_days=$4,signature_minimum_dao=$5,signature_minimum_city=$6 WHERE singleton",[settings.fractionDao,settings.fractionCity,settings.days,settings.cooldownDays,settings.minimumDao,settings.minimumCity]);
}
export async function createSignatureCallWithDatabase(database: ProposalDatabase, authorId:string,title:unknown,body:unknown,config:PollConfig) {
  normalizePollConfig(config);
  // The existing proposal transaction and DB guards own config, circle, threshold and cooldown.
  return createProposalWithDatabase(database,authorId,title,body,{...config,bySignatures:true});
}
export async function setSignatureWithDatabase(database:ProposalDatabase,id:string,participantId:string,support:boolean):Promise<void> {
  if(!validPollId(id))throw new VecheError("invalid");
  const client=await database.connect();let blocked=false;
  try {
    await client.query("BEGIN");
    const state=(await client.query("SELECT veche_refresh_call($1) AS state",[id])).rows[0]?.state;
    if(state!=="collecting")blocked=true;
    else if(support)await client.query("INSERT INTO proposal_signatures(proposal_id,participant_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[id,participantId]);
    else await client.query("DELETE FROM proposal_signatures WHERE proposal_id=$1 AND participant_id=$2",[id,participantId]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  if(blocked)throw new VecheError("closed");
}
export async function refreshSignatureCalls(database:ProposalDatabase):Promise<void>{
  const client=await database.connect();
  try {const rows=(await client.query("SELECT id FROM proposals WHERE poll_call_state='collecting' ORDER BY id")).rows;
    for(const row of rows)await client.query("SELECT veche_refresh_call($1)",[row.id]);
  }finally{client.release();}
}
export async function createSignatureCall(authorId:string,title:unknown,body:unknown,config:PollConfig){const{pool}=await import("./db");return createSignatureCallWithDatabase(pool,authorId,title,body,config);}
export async function setSignature(id:string,participantId:string,support:boolean){const{pool}=await import("./db");return setSignatureWithDatabase(pool,id,participantId,support);}
