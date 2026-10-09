import Link from "next/link";
import type { PublicFreeze } from "../lib/veche-empty";
import type { InterfaceTextValues } from "../lib/interface-texts";
import { LocalDateTime } from "./local-date-time";
export function VecheFreezes({records,texts}:{records:PublicFreeze[];texts:InterfaceTextValues}){
 if(!records.length)return null;
 return <section><h2>{texts['veche.freezes']}</h2><ul>{records.map(record=><li key={record.id}>
  <p>{texts[record.action==='unfreeze'?'veche.freeze_lifted':record.active?'veche.freeze_active':'veche.freeze_expired']}</p>
  <Link href={`/veche/${record.decision.id}`}>{record.decision.title}</Link>
  {record.expiresAt?<p><LocalDateTime value={record.expiresAt}/></p>:null}
  <ul>{record.questions.map(question=><li key={question.id}><Link href={`/veche/${question.id}`}>{question.title}</Link></li>)}</ul>
 </li>)}</ul></section>;
}
