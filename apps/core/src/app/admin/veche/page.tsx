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
export default async function VecheSettingsPage({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const [settings, { values: texts }, query] = await Promise.all([readVecheSettings(pool), readInterfaceTexts(), searchParams]);
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
      <p>{texts["veche.quorum_hint"]}</p><button className="button primary">{texts["veche.save"]}</button>
    </form><Link href="/veche">{texts["veche.back"]}</Link>
  </section></main>;
}
