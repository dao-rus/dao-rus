import Link from "next/link";
import {redirect} from "next/navigation";
import {pool} from "@/lib/db";
import {getCurrentParticipant} from "@/lib/session";
import {hasPrototypeAdminAccess} from "@/lib/config";
import {readInterfaceTexts} from "@/lib/interface-texts";
import {listProposals} from "@/lib/proposals";
import {readCallAvailability,listVecheCards} from "@/lib/veche-presentation";
import {readPublicFreezes} from "@/lib/veche-empty";
import {VecheFreezes} from "@/components/veche-freezes";
import {LocalDateTime} from "@/components/local-date-time";
import {CoreNavigation} from "@/components/core-navigation";
import {UserText} from "@/components/user-text";
export const dynamic='force-dynamic';
export async function generateMetadata(){return {title:(await readInterfaceTexts()).values['veche.ui_heading']};}
export default async function VechePage({searchParams}:{searchParams:Promise<{call?:string}>}){
 const actor=await getCurrentParticipant();if(!actor)redirect('/');
 const [proposals,availability,{values:texts},freezes,query,questions]=await Promise.all([listProposals(),readCallAvailability(pool,actor.id),readInterfaceTexts(),readPublicFreezes(pool),searchParams,listVecheCards(pool,actor.id)]);
 const archive=proposals.filter(p=>!p.hasPoll);
 return <main className="shell"><section className="card proposalsPage"><CoreNavigation current="veche"/>
  <h1>{texts['veche.ui_heading']}</h1><p>{texts['veche.ui_intro']}</p>
  {availability.quotes.length||(availability.reason&&availability.opened)?<Link className="button primary" href="/veche/new">{texts['veche.ui_new']}</Link>:<p>{texts['veche.ui_not_open']}</p>}
  {query.call==='failed'?<p role="status">{texts['veche.call_failed']}</p>:null}
  {(['collecting','running','closed'] as const).map(group=>{
   const rows=questions.filter(q=>group==='closed'?['closed','not_called'].includes(q.state):q.state===group);if(!rows.length)return null;
   return <section key={group}><h2>{texts[`veche.ui_${group}_group`]}</h2><ul className="proposalList">{rows.map(q=><li key={q.proposal.id}>
    <h3><Link href={`/veche/${q.proposal.id}`}>{q.proposal.title}</Link></h3>
    <p>{texts[q.state==='collecting'?'veche.collecting':q.state==='not_called'?'veche.not_called':q.state==='closed'?'veche.closed':'veche.running']} · {q.circle==='dao'?texts['veche.ui_all_dao']:q.city} · {texts[`veche.${q.mode}`]}</p>
    {['collecting','not_called'].includes(q.state)?<p>{texts['veche.ui_sign_until']} <LocalDateTime value={q.signatureDeadline!}/> · {texts["veche.ui_signature_progress"].replace("{count}",String(q.counted)).replace("{required}",String(q.required))}</p>:q.deadline?<p>{texts['veche.ui_vote_until']} <LocalDateTime value={q.deadline}/></p>:<p>{texts['veche.ui_until_relevant']}</p>}
    {q.signed?<p>{texts['veche.ui_signed']}</p>:null}{q.voted?<p>{texts['veche.ui_voted']}</p>:null}
    <p>{q.proposal.authorParticipantId?<Link href={`/profile/${q.proposal.authorParticipantId}`}>{q.proposal.authorDisplayName}</Link>:texts['veche.anonymous_author']}</p>
   </li>)}</ul></section>;
  })}
  <VecheFreezes records={freezes} texts={texts}/>
  {archive.length?<details><summary>{texts['veche.ui_archive']}</summary><ul>{archive.map(p=><li key={p.id}><h3>{p.title}</h3><UserText text={p.body}/><p>{p.authorDisplayName}</p></li>)}</ul></details>:null}
  {hasPrototypeAdminAccess(actor.id)?<Link className="button secondary" href="/admin/veche">{texts['veche.settings']}</Link>:null}
 </section></main>;
}
