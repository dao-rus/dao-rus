import { readEmptySettings, readEmptySignals, readPublicFreezes } from "@/lib/veche-empty";
import { VecheFreezes } from "@/components/veche-freezes";
import { readFinanceSettings, financeFields } from "@/lib/veche-finance";
import { readSignatureSettings } from "@/lib/veche-signatures";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentParticipant } from "@/lib/session";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { readVecheSettings } from "@/lib/veche-polls";
import { pool } from "@/lib/db";
import { CoreNavigation } from "@/components/core-navigation";
import { AdminCrumbs } from "@/components/admin-crumbs";
export const dynamic = "force-dynamic";
export async function generateMetadata() { const { values } = await readInterfaceTexts(); return { title: values["veche.settings"] }; }
export default async function VecheSettingsPage({ searchParams }: { searchParams: Promise<{ outcome?: string; freeze?: string }> }) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const [settings, { values: texts }, query, signatures, finance, empty, signals, freezes] = await Promise.all([readVecheSettings(pool), readInterfaceTexts(), searchParams, readSignatureSettings(pool), readFinanceSettings(pool),readEmptySettings(pool),readEmptySignals(pool),readPublicFreezes(pool)]);
  return <main className="shell"><section className="card profile"><CoreNavigation />
    <AdminCrumbs href="/admin/veche" texts={texts} /><h1>{texts["veche.settings"]}</h1>
    {query.outcome ? <p role="status">{texts[query.outcome === "saved" ? "veche.saved" : "veche.invalid"]}</p> : null}
    <form className="interfaceForm" action="/api/admin/veche" method="post">
      <label htmlFor="inactivity">{texts["veche.inactivity"]}</label>
      <input id="inactivity" name="inactivityDays" type="number" min="1" max="36500" step="1" defaultValue={settings.inactivityDays ?? ""} />
      <p>{texts["veche.inactivity_hint"]}</p>
      {(["Dao", "City"] as const).map(circle => <div className="interfaceField" key={circle}>
        <label htmlFor={`quorum${circle}`}>{texts[circle === "Dao" ? "veche.quorum_dao" : "veche.quorum_city"]}</label>
        <input id={`quorum${circle}`} name={`quorum${circle}`} type="number" min="0" max="1" step="0.000001" required defaultValue={settings[`quorum${circle}`]} />
      </div>)}
      <p>{texts["veche.quorum_hint"]}</p>
      {(["Dao", "City"] as const).map(circle => <div className="interfaceField" key={circle}>
        <label htmlFor={`fraction${circle}`}>{texts[circle === "Dao" ? "veche.signature_dao" : "veche.signature_city"]}</label>
        <input id={`fraction${circle}`} name={`fraction${circle}`} type="number" min="0.000001" max="1" step="0.000001" defaultValue={signatures[`fraction${circle}`] ?? ""} />
      </div>)}
      {(["Dao","City"] as const).map(circle=><div className="interfaceField" key={`minimum${circle}`}><label htmlFor={`minimum${circle}`}>{texts[circle==="Dao"?"veche.minimum_dao":"veche.minimum_city"]}</label><input id={`minimum${circle}`} name={`minimum${circle}`} type="number" min="1" max="2147483647" step="1" defaultValue={signatures[`minimum${circle}`]??5} required /></div>)}
      <label htmlFor="signatureDays">{texts["veche.signature_days"]}</label><input id="signatureDays" name="signatureDays" type="number" min="1" max="36500" step="1" defaultValue={signatures.days} required />
      <label htmlFor="signatureCooldown">{texts["veche.signature_cooldown"]}</label><input id="signatureCooldown" name="signatureCooldown" type="number" min="0" max="36500" step="1" defaultValue={signatures.cooldownDays ?? ""} />
      <p>{texts["veche.signature_unset"]}</p>
      <p>{texts["veche.finance_hint"]}</p>
      {Object.keys(financeFields).map(key=><div className="interfaceField" key={key}><label htmlFor={key}>{texts[`veche.${key}` as keyof typeof texts]}</label><input id={key} name={key} type="number" step={key.endsWith("Days")?"1":"0.000001"} min={key.endsWith("Days")?"1":"0"} defaultValue={finance[key as keyof typeof finance]??""} /></div>)}
      {(["emptyFraction","emptySignalCount","emptySignalDays"] as const).map(key=><div className="interfaceField" key={key}><label htmlFor={key}>{texts[`veche.${key}`]}</label><input id={key} name={key} type="number" min={key==="emptyFraction"?"0.000001":"1"} max={key==="emptyFraction"?"1":key==="emptySignalDays"?"36500":"2147483647"} step={key==="emptyFraction"?"0.000001":"1"} defaultValue={empty[key]??""}/></div>)}
      <button className="button primary">{texts["veche.save"]}</button>
    </form>
    {signals.length?<section><h2>{texts["veche.empty_signals"]}</h2>{signals.map(signal=><div key={signal.authorId}><p>{signal.displayName}</p><ul>{signal.questions.map(q=><li key={q.id}><Link href={`/veche/${q.id}`}>{q.title}</Link></li>)}</ul></div>)}</section>:null}
    <VecheFreezes records={freezes} texts={texts}/>
    {query.freeze?<p role="status">{texts[query.freeze==="saved"?"veche.freeze_recorded":"veche.freeze_failed"]}</p>:null}
    <h2>{texts["veche.freeze_form"]}</h2>
    <form className="interfaceForm" action="/api/admin/veche/freeze" method="post">
      <label htmlFor="freeze-source">{texts["veche.freeze_source"]}</label><input id="freeze-source" name="source" required/>
      <label htmlFor="freeze-decision">{texts["veche.freeze_decision"]}</label><input id="freeze-decision" name="decision" required/>
      <label htmlFor="freeze-expiry">{texts["veche.freeze_expiry"]}</label><input id="freeze-expiry" name="expiresAt" type="datetime-local"/>
      <label><input name="attest" type="checkbox" value="yes" required/>{texts["veche.freeze_attestation"]}</label>
      <button className="button secondary" name="action" value="freeze">{texts["veche.freeze"]}</button>
      <button className="button secondary" name="action" value="unfreeze">{texts["veche.unfreeze"]}</button>
    </form><Link href="/veche">{texts["veche.back"]}</Link>
  </section></main>;
}
