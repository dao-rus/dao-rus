import {VecheMissingCity} from "@/components/veche-missing-city";
import {UserText} from "@/components/user-text";
import Link from "next/link";
import {redirect} from "next/navigation";
import {getCurrentParticipant} from "@/lib/session";
import {pool} from "@/lib/db";
import {readInterfaceTexts} from "@/lib/interface-texts";
import {readCallAvailability,wizardValues,wizardHref,invalidWizardStep,type WizardValues} from "@/lib/veche-presentation";
import {CoreNavigation} from "@/components/core-navigation";
import {LocalDateTime} from "@/components/local-date-time";
export const dynamic='force-dynamic';
export async function generateMetadata(){return {title:(await readInterfaceTexts()).values['veche.ui_new']};}
export default async function NewVeche({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const actor=await getCurrentParticipant();if(!actor)redirect('/');
 const [query,availability,{values:texts}]=await Promise.all([searchParams,readCallAvailability(pool,actor.id),readInterfaceTexts()]);
 const text=(key:string,values:Record<string,string|number>={})=>Object.entries(values).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',String(v)),texts[('veche.ui_'+key) as keyof typeof texts]);
 const shell=(content:React.ReactNode)=><main className="shell"><section className="card profile"><CoreNavigation current="veche"/><Link href="/veche">{texts['veche.back']}</Link><h1>{text('new')}</h1>{content}</section></main>;
 if(!availability.city)return shell(<VecheMissingCity texts={texts}/>);
 if(availability.reason)return shell(<p>{text(availability.reason==='frozen'?'frozen_reason':'not_member')} {availability.decisionId?<Link href={`/veche/${availability.decisionId}`}>{text('decision_link')}</Link>:null}</p>);
 if(!availability.quotes.length)return shell(<p>{text('not_open')}</p>);
 if(availability.quotes.every(q=>q.price===null&&q.cooldownUntil!==null)){
  const until=availability.quotes.map(q=>q.cooldownUntil!).sort()[0];return shell(<p>{text('cooldown')} <LocalDateTime value={until}/></p>);
 }
 const v=wizardValues(query),step=typeof query.step==='string'&&/^[1-6]$/.test(query.step)?Number(query.step):1;
 if(!v.circle&&availability.quotes.length===1)v.circle=availability.quotes[0].circle;
 const invalid=invalidWizardStep(v,step-1,availability.quotes.map(q=>q.circle));
 if(invalid)redirect(wizardHref(v,invalid,{error:'1'}));
 const hidden=(omit:Array<keyof WizardValues>=[])=>Object.entries(v).filter(([k])=>!omit.includes(k as keyof WizardValues)).map(([key,value])=><input type="hidden" key={key} name={key} value={value}/>);
 const back=<Link className="button secondary" href={step===1?'/veche':wizardHref(v,step-1)}>{text('previous')}</Link>;
 const audience=(circle:string)=>text(circle==='dao'?'audience_dao':'audience_city',{city:availability.city});
 const headings=['question','audience','voting','duration','your_name','review'];
 const quote=availability.quotes.find(q=>q.circle===v.circle)!;
 return shell(<>
  <p>{text('step',{step})}</p><h2>{text(headings[step-1])}</h2>
  {query.error?<p role="alert">{text(query.error==='create'?'call_retry':'invalid_step')}</p>:null}
  {step<6?<form action="/veche/new" method="get" className="interfaceForm">
   <input type="hidden" name="step" value={step+1}/>
   {hidden(step===1?['title','body']:step===2?['circle']:step===3?['mode']:step===4?['duration','deadline']:['authorVisibility'])}
   {step===1?<><p>{text('question_hint')}</p><label htmlFor="title">{text('question_title')}</label><input id="title" name="title" required defaultValue={v.title}/><label htmlFor="body">{text('question_body')}</label><textarea id="body" name="body" required rows={6} defaultValue={v.body}/></>:null}
   {step===2?availability.quotes.length===1?<><p>{audience(v.circle)}</p><input name="circle" type="hidden" value={v.circle}/></>:availability.quotes.map(q=><label key={q.circle}><input name="circle" type="radio" value={q.circle} required defaultChecked={v.circle===q.circle}/>{audience(q.circle)}</label>):null}
   {step===3?(['secret','open'] as const).map(mode=><label key={mode}><input name="mode" type="radio" value={mode} defaultChecked={v.mode===mode}/>{text('voting_'+mode)}</label>):null}
   {step===4?<>
    {['3','7','14','custom','permanent'].map(duration=><label key={duration}><input name="duration" type="radio" value={duration} defaultChecked={v.duration===duration}/>{duration==='custom'?text('custom_date'):duration==='permanent'?text('until_relevant'):text(duration==='3'?'three_days':'days',{days:duration})}</label>)}
    {v.duration==='custom'?<><label htmlFor="deadline">{text('custom_label')}</label><input id="deadline" name="deadline" type="datetime-local" defaultValue={v.deadline}/></>:<input type="hidden" name="deadline" value={v.deadline}/>}
    <p>{text('until_hint')}</p>
   </>:null}
   {step===5?<>{(['public','anonymous'] as const).map(visibility=><label key={visibility}><input name="authorVisibility" type="radio" value={visibility} defaultChecked={v.authorVisibility===visibility}/>{text(visibility==='public'?'name_public':'name_hidden')}</label>)}<p>{texts['veche.author_warning']}</p></>:null}
   <div>{back} <button className="button primary">{text('next')}</button></div>
  </form>:<>
   <dl>{[v.title,audience(v.circle),text('voting_'+v.mode),v.duration==='custom'?v.deadline:v.duration==='permanent'?text('until_relevant'):text(v.duration==='3'?'three_days':'days',{days:v.duration}),text(v.authorVisibility==='public'?'name_public':'name_hidden')].map((value,index)=><div key={index}><dt>{text(headings[index])} <Link href={wizardHref(v,index+1)}>{text('edit')}</Link></dt><dd>{value}{index===0?<UserText text={v.body}/>:null}</dd></div>)}</dl>
   {quote.required!==null?<section><p>{text('sign_consequence',{required:quote.required,days:quote.days,audience:text(v.circle==='dao'?'signature_audience_dao':'signature_audience_city',{city:availability.city})})}</p>
    {quote.cooldownUntil?<p>{text('cooldown')} <LocalDateTime value={quote.cooldownUntil}/></p>:<form action="/api/veche" method="post">{hidden()}<input name="wizard" type="hidden" value="yes"/><button className="button primary" name="path" value="signatures">{text('sign_button')}</button></form>}
   </section>:null}
   {quote.price!==null?<section><p>{text('paid_consequence')}</p><form action="/api/veche" method="post">{hidden()}<input name="wizard" type="hidden" value="yes"/><button className="button primary" name="path" value="paid" disabled={!quote.affordable}>{text('paid_button',{price:quote.price})}</button></form>{!quote.affordable?<p>{text('balance',{balance:quote.balance})}</p>:null}</section>:null}
   {back}
  </>}
 </>);
}
