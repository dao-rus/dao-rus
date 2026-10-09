import type { ProposalDatabase, ProposalDatabaseClient } from "./proposals";
import { createProposalWithDatabase } from "./proposals";
import { VecheError, type PollConfig } from "./veche-polls";
type Reader = Pick<ProposalDatabaseClient,"query">;
export const financeFields = {
 tariffBaseDao:"tariff_base_dao",tariffBaseCity:"tariff_base_city",
 tariffMultiplierDao:"tariff_multiplier_dao",tariffMultiplierCity:"tariff_multiplier_city",
 attentionDays:"attention_days",organizerFraction:"organizer_fraction",organizerCooldownDays:"organizer_cooldown_days",
 participationAmount:"veche_participation",organizerAmount:"veche_organizer",
} as const;
export type FinanceSettings = Record<keyof typeof financeFields,string | null>;
export async function readFinanceSettings(database:Reader):Promise<FinanceSettings>{
 const row=(await database.query("SELECT * FROM veche_settings WHERE singleton")).rows[0];
 const result={} as FinanceSettings;
 for(const [key,column] of Object.entries(financeFields)) {
  if(key.endsWith("Amount")) {
   const rule=(await database.query("SELECT amount,active FROM reward_rules WHERE action_type=$1 AND effective_from<=clock_timestamp() AND (effective_to IS NULL OR effective_to>clock_timestamp()) ORDER BY version DESC LIMIT 1",[column])).rows[0];
   result[key as keyof FinanceSettings]=rule.active?String(rule.amount):"0";
  } else result[key as keyof FinanceSettings]=row[column]===null?null:String(row[column]);
 }
 return result;
}
export function parseFinanceSettings(input:Record<keyof FinanceSettings,unknown>):FinanceSettings {
 const result={} as FinanceSettings;
 for(const key of Object.keys(financeFields) as Array<keyof FinanceSettings>){
  const value=String(input[key]??"").trim();
  if(!value&&!key.endsWith("Amount")&&key!=="attentionDays"){result[key]=null;continue;}
  if(key.endsWith("Days")) {
   if(!/^\d{1,5}$/.test(value)||Number(value)<1||Number(value)>36500)throw new VecheError("invalid");
  } else {
   if(!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(value))throw new VecheError("invalid");
   if(!key.endsWith("Amount")&&Number(value)<=0)throw new VecheError("invalid");
   if(key==="organizerFraction"&&Number(value)>1)throw new VecheError("invalid");
  }
  result[key]=value;
 }
 return result;
}
export async function saveFinanceSettings(database:Reader,actorId:string,input:FinanceSettings){
 const settings=parseFinanceSettings(input);
 // Caller owns the transaction, together with all other Veche settings.
 await database.query("LOCK TABLE reward_rules IN SHARE ROW EXCLUSIVE MODE");
 for(const key of ["participationAmount","organizerAmount"] as const){
  const action=financeFields[key], amount=settings[key]!;
  const previous=(await database.query("SELECT version,amount,active FROM reward_rules WHERE action_type=$1 ORDER BY version DESC LIMIT 1",[action])).rows[0];
  const active=/[1-9]/.test(amount);
  const exact=(value:string)=>{const [whole,fraction=""]=value.split(".");return `${whole}.${fraction.padEnd(6,"0")}`;};
  if(String(previous.amount)!==exact(amount)||previous.active!==active)
   await database.query("INSERT INTO reward_rules(action_type,version,amount,active,changed_by,effective_from) VALUES($1,$2,$3,$4,$5,clock_timestamp())",[action,Number(previous.version)+1,amount,active,actorId]);
 }
 const keys=(Object.keys(financeFields) as Array<keyof FinanceSettings>).filter(key=>!key.endsWith("Amount"));
 await database.query(`UPDATE veche_settings SET ${keys.map((key,i)=>`${financeFields[key]}=$${i+1}`).join(",")} WHERE singleton`,keys.map(key=>settings[key]));
}
export async function paidCallPrices(database:Reader,participantId:string):Promise<Partial<Record<"dao"|"city",string>>>{
 const rows=(await database.query(`SELECT circle, trunc(base*multiplier*population,6)::text AS price,
 COALESCE((SELECT sum(amount) FROM darus_book WHERE participant_id=$1),0)>=trunc(base*multiplier*population,6) AS affordable FROM (
 SELECT circle,CASE circle WHEN 'dao' THEN s.tariff_base_dao ELSE s.tariff_base_city END AS base,
 CASE circle WHEN 'dao' THEN s.tariff_multiplier_dao ELSE s.tariff_multiplier_city END AS multiplier,
 (SELECT count(*) FROM participants member WHERE veche_eligible(member,circle,lower(btrim(actor.residence_name)))) AS population
 FROM veche_settings s,participants actor,unnest(ARRAY['dao','city']) circle WHERE s.singleton AND actor.id=$1 AND veche_eligible(actor,'dao',NULL)
 ) quotes`,[participantId])).rows;
 return Object.fromEntries(rows.filter(row=>row.affordable===true&&Number(row.price)>0).map(row=>[row.circle,String(row.price)]));
}
export async function createPaidCallWithDatabase(database:ProposalDatabase,authorId:string,title:unknown,body:unknown,config:PollConfig){
 return createProposalWithDatabase(database,authorId,title,body,{...config,bySignatures:false,paid:true});
}
export async function createPaidCall(authorId:string,title:unknown,body:unknown,config:PollConfig){const{pool}=await import("./db");return createPaidCallWithDatabase(pool,authorId,title,body,config);}
export async function settleDueVeche(database:Reader){
 const rows=(await database.query(`SELECT p.id FROM proposals p JOIN veche_finance f ON f.proposal_id=p.id
 WHERE (p.poll_closed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM veche_settlements WHERE proposal_id=p.id AND kind='rewards'))
 OR (f.hold_id IS NOT NULL AND p.poll_deadline IS NULL AND COALESCE(p.poll_called_at,f.started_at)+make_interval(days=>f.attention_days)<=clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM veche_settlements WHERE proposal_id=p.id AND kind='attention')) ORDER BY p.id`)).rows;
 for(const row of rows)await database.query("SELECT veche_settle($1)",[row.id]);
}
