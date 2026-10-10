import { publicProposal, type ProposalDatabaseClient, type ProposalDatabase } from "./proposals";
import { closeDuePolls, validPollId, type VoteChoice } from "./veche-polls";
type Reader=Pick<ProposalDatabaseClient,"query">;
export type CallQuote={circle:'dao'|'city';population:number;required:number|null;days:number;price:string|null;balance:string;affordable:boolean;cooldownUntil:string|null};
export type CallAvailability={reason:'member'|'city'|'frozen'|null;opened:boolean;city:string;decisionId:string|null;quotes:CallQuote[]};
// Presentation reads the same SQL formula/settings as the creation trigger; POST still owns final validation.
export async function readCallAvailability(db:Reader,actorId:string):Promise<CallAvailability>{
 const actor=(await db.query(`SELECT membership_status,residence_name,veche_author_frozen(id) AS frozen,
 EXISTS(SELECT 1 FROM veche_settings WHERE singleton AND ((signature_cooldown_days IS NOT NULL AND (signature_fraction_dao IS NOT NULL OR signature_fraction_city IS NOT NULL)) OR (tariff_base_dao IS NOT NULL AND tariff_multiplier_dao IS NOT NULL) OR (tariff_base_city IS NOT NULL AND tariff_multiplier_city IS NOT NULL))) AS opened FROM participants WHERE id=$1`,[actorId])).rows[0];
 const city=String(actor?.residence_name??'').trim();
 const reason=!actor||actor.membership_status!=='participant'?'member':!city?'city':actor.frozen===true?'frozen':null;
 let decisionId:string|null=null;
 if(reason==='frozen')decisionId=String((await db.query(`SELECT f.decision_proposal_id FROM veche_convocation_freezes f JOIN proposals p ON p.id=f.source_proposal_id
 WHERE p.author_participant_id=$1 AND p.author_visibility='public' AND p.poll_empty ORDER BY f.created_at DESC,f.id DESC LIMIT 1`,[actorId])).rows[0].decision_proposal_id);
 const opened=actor?.opened===true;
 if(reason)return {reason,opened,city,decisionId,quotes:[]};
 const rows=(await db.query(`SELECT circle,population,signature_days,
 CASE WHEN fraction IS NOT NULL AND signature_cooldown_days IS NOT NULL THEN greatest(minimum,ceil(population*fraction)::integer) END AS required,
 CASE WHEN base IS NOT NULL AND multiplier IS NOT NULL AND trunc(base*multiplier*population,6)>0 THEN trunc(base*multiplier*population,6)::text END AS price,
 balance::text,balance>=trunc(base*multiplier*population,6) AS affordable,
 (SELECT max(COALESCE(p.poll_signature_failed_at,least(p.poll_signature_deadline,coalesce(p.poll_deadline,p.poll_signature_deadline)))+make_interval(days=>signature_cooldown_days))
 FROM proposals p WHERE p.author_participant_id=$1 AND p.poll_circle=circle AND p.poll_city IS NOT DISTINCT FROM city_key
 AND (p.poll_call_state='not_called' OR (p.poll_call_state='collecting' AND least(p.poll_signature_deadline,coalesce(p.poll_deadline,p.poll_signature_deadline))<=clock_timestamp()))
 AND COALESCE(p.poll_signature_failed_at,least(p.poll_signature_deadline,coalesce(p.poll_deadline,p.poll_signature_deadline)))+make_interval(days=>signature_cooldown_days)>clock_timestamp()) AS cooldown_until
 FROM (SELECT circle,signature_days,signature_cooldown_days,
 CASE circle WHEN 'dao' THEN signature_fraction_dao ELSE signature_fraction_city END AS fraction,
 CASE circle WHEN 'dao' THEN signature_minimum_dao ELSE signature_minimum_city END AS minimum,
 CASE circle WHEN 'dao' THEN tariff_base_dao ELSE tariff_base_city END AS base,
 CASE circle WHEN 'dao' THEN tariff_multiplier_dao ELSE tariff_multiplier_city END AS multiplier,
 CASE circle WHEN 'city' THEN lower(btrim(actor.residence_name)) END AS city_key,
 (SELECT count(*) FROM participants p WHERE veche_eligible(p,circle,lower(btrim(actor.residence_name)))) AS population,
 COALESCE((SELECT sum(amount) FROM darus_book WHERE participant_id=$1),0) AS balance
 FROM veche_settings s,participants actor,unnest(ARRAY['dao','city']) circle WHERE s.singleton AND actor.id=$1) quotes`,[actorId])).rows;
 return {reason,opened,city,decisionId,quotes:rows.map(r=>({circle:r.circle as CallQuote['circle'],population:Number(r.population),required:r.required===null?null:Number(r.required),days:Number(r.signature_days),price:r.price===null?null:String(r.price),balance:String(r.balance),affordable:r.affordable===true,cooldownUntil:r.cooldown_until?new Date(String(r.cooldown_until)).toISOString():null})).filter(q=>q.required!==null||q.price!==null)};
}
// Private scalar: used only by the dynamic authenticated page, never by the shared poll API.
export async function readOwnVote(db:Reader,id:string,sessionActor:string):Promise<VoteChoice|null>{
 if(!validPollId(id))return null;
 const r=(await db.query('SELECT choice FROM proposal_votes WHERE proposal_id=$1 AND participant_id=$2',[id,sessionActor])).rows[0];
 return r?r.choice as VoteChoice:null;
}
export async function countPendingVecheWithDatabase(db:Reader,actor:string):Promise<number>{
 const r=(await db.query(`SELECT count(*) AS n FROM proposals p,participants member,veche_settings s
 WHERE member.id=$1 AND s.singleton AND p.poll_circle IS NOT NULL AND p.poll_closed_at IS NULL
 AND veche_eligible(member,p.poll_circle,p.poll_city)
 AND (p.poll_deadline IS NULL OR p.poll_deadline>clock_timestamp()) AND (
 (p.poll_call_state='collecting' AND p.poll_signature_deadline>clock_timestamp() AND NOT veche_author_frozen(p.author_participant_id)
 AND NOT EXISTS(SELECT 1 FROM proposal_signatures WHERE proposal_id=p.id AND participant_id=$1)) OR
 ((p.poll_call_state IS NULL OR p.poll_call_state='called')
 AND (p.poll_deadline IS NOT NULL OR s.inactivity_days IS NULL OR p.poll_last_new_vote_at+make_interval(days=>s.inactivity_days)>clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM proposal_votes WHERE proposal_id=p.id AND participant_id=$1)))`,[actor])).rows[0];return Number(r.n);
}
export async function countPendingVeche(actor:string){const{pool}=await import('./db');return countPendingVecheWithDatabase(pool,actor);}
export type WizardValues={title:string;body:string;circle:string;mode:string;duration:string;deadline:string;authorVisibility:string};
export function wizardValues(input:Record<string,string|string[]|undefined>):WizardValues{
 const value=(key:string,fallback='')=>typeof input[key]==='string'?input[key] as string:fallback;
 return {title:value('title'),body:value('body'),circle:value('circle'),mode:value('mode','secret'),duration:value('duration','7'),deadline:value('deadline'),authorVisibility:value('authorVisibility','public')};
}
export function invalidWizardStep(v:WizardValues,through:number,circles:string[],now=Date.now()):number|null{
 if(through>=1&&(!v.title.trim()||!v.body.trim()))return 1;
 if(through>=2&&!circles.includes(v.circle))return 2;
 if(through>=3&&!['secret','open'].includes(v.mode))return 3;
 if(through>=4&&(!['3','7','14','custom','permanent'].includes(v.duration)||(v.duration==='custom'&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.deadline)||!Number.isFinite(new Date(v.deadline+':00+03:00').getTime())||new Date(v.deadline+':00+03:00').getTime()<=now))))return 4;
 if(through>=5&&!['public','anonymous'].includes(v.authorVisibility))return 5;
 return null;
}
export function wizardDeadline(v:WizardValues,now=Date.now()):Date|null{
 if(v.duration==='permanent')return null;
 if(v.duration==='custom')return new Date(v.deadline+':00+03:00');
 return new Date(now+Number(v.duration)*86400000);
}
export function wizardHref(v:WizardValues,step:number,extra:Record<string,string>={}){return '/veche/new?'+new URLSearchParams({...v,step:String(step),...extra}).toString();}
export async function listVecheCards(db:Reader & ProposalDatabase,actor:string){
 // Refresh only transitions that are due, rather than locking every question for each card.
 const due=(await db.query(`SELECT id FROM proposals p WHERE poll_call_state='collecting' AND
 (least(poll_signature_deadline,coalesce(poll_deadline,poll_signature_deadline))<=clock_timestamp() OR veche_signature_count(p)>=poll_signatures_required) ORDER BY id`)).rows;
 for(const p of due)await db.query('SELECT veche_refresh_call($1)',[p.id]);
 await closeDuePolls(db);
 const rows=(await db.query(`SELECT p.id,p.title,'' AS body,p.status,p.created_at,p.author_visibility,p.author_participant_id,
 author.display_name AS author_display_name,p.poll_circle,p.poll_city,p.poll_mode,p.poll_deadline,p.poll_closed_at,p.poll_call_state,
 p.poll_signature_deadline,p.poll_signatures_required,coalesce(p.poll_signature_count_at_call,veche_signature_count(p)) AS signature_count,
 EXISTS(SELECT 1 FROM proposal_signatures WHERE proposal_id=p.id AND participant_id=$1) AS signed,
 EXISTS(SELECT 1 FROM proposal_votes WHERE proposal_id=p.id AND participant_id=$1) AS voted
 FROM proposals p JOIN participants author ON author.id=p.author_participant_id WHERE poll_circle IS NOT NULL ORDER BY p.created_at DESC,p.id`,[actor])).rows;
 return rows.map(row=>({proposal:publicProposal(row),circle:row.poll_circle as 'dao'|'city',city:String(row.poll_city??''),mode:row.poll_mode as 'secret'|'open',
  deadline:row.poll_deadline?new Date(String(row.poll_deadline)).toISOString():null,signatureDeadline:row.poll_signature_deadline?new Date(String(row.poll_signature_deadline)).toISOString():null,
  required:Number(row.poll_signatures_required),counted:Number(row.signature_count),signed:row.signed===true,voted:row.voted===true,
  state:row.poll_call_state==='collecting'?'collecting':row.poll_call_state==='not_called'?'not_called':row.poll_closed_at?'closed':'running'}));
}
