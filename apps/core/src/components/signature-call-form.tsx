import type { InterfaceTextValues } from "../lib/interface-texts";
import type { SignatureSettings } from "../lib/veche-signatures";
export function SignatureCallForm({texts,settings}:{texts:InterfaceTextValues;settings:SignatureSettings}){
 const circles=(["dao","city"] as const).filter(circle=>settings.cooldownDays!==null&&(circle==="dao"?settings.fractionDao:settings.fractionCity)!==null);
 if(!circles.length)return null;
 return <form className="proposalForm" action="/api/veche" method="post">
  <h2>{texts["veche.call_create"]}</h2><p>{texts["veche.signature_meaning"]}</p>
  <label htmlFor="callTitle">{texts["veche.call_title"]}</label><input id="callTitle" name="title" required />
  <label htmlFor="callBody">{texts["veche.call_body"]}</label><textarea id="callBody" name="body" required rows={5} />
  <label htmlFor="callCircle">{texts["veche.call_circle"]}</label><select id="callCircle" name="circle">{circles.map(circle=><option key={circle} value={circle}>{texts[`veche.${circle}`]}</option>)}</select>
  <label htmlFor="callMode">{texts["veche.call_mode"]}</label><select id="callMode" name="mode"><option value="secret">{texts["veche.secret"]}</option><option value="open">{texts["veche.open"]}</option></select>
  <label htmlFor="callTiming">{texts["veche.call_timing"]}</label><select id="callTiming" name="timing"><option value="permanent">{texts["veche.permanent"]}</option><option value="deadline">{texts["veche.call_deadline_option"]}</option></select>
  <label htmlFor="callDeadline">{texts["veche.call_deadline"]}</label><input id="callDeadline" name="deadline" type="datetime-local" />
  <p>{texts["veche.signature_days"]}: {settings.days} · {texts["veche.signature_cooldown"]}: {settings.cooldownDays}</p>
  <button className="button primary">{texts["veche.call_create"]}</button>
 </form>;
}
