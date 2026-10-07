import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CoreNavigation } from "../../../../components/core-navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { getGuardianArrivals } from "../../../../lib/guardian-arrivals";
import { readInterfaceTexts } from "../../../../lib/interface-texts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "История прибытия" };
export default async function GuardianArrivalsPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const [arrivals, { values: texts }] = await Promise.all([getGuardianArrivals(), readInterfaceTexts()]);
  return <main className="shell"><section className="card profile">
    <CoreNavigation />
    <h1>{texts["guardian.arrivals_title"]}</h1>
    <Link className="button secondary" href="/admin/guardian">{texts["guardian.back"]}</Link>
    <p>{texts["guardian.arrivals_recent"]} <strong>{arrivals.last30Days}</strong></p>
    <p>{texts["guardian.arrivals_total"]} <strong>{arrivals.total}</strong></p>
    {arrivals.events.length ? <ul>{arrivals.events.map(event => <li key={event.id}>
      <time dateTime={event.observedAt.toISOString()}>{event.observedAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</time>
      {" · "}{event.participantId ? <Link href={`/profile/${event.participantId}`}>{event.displayName ?? event.username ?? texts["guardian.profile_unavailable"]}</Link> : texts["guardian.profile_unavailable"]}
      {event.username ? <> · {event.username.startsWith("@") ? event.username : "@" + event.username}</> : null}
      {" · "}{texts[event.type === "forum.rejoined" ? "guardian.arrival_rejoined" : "guardian.arrival_joined"]}
    </li>)}</ul> : <p className="muted">{texts["guardian.arrivals_empty"]}</p>}
  </section></main>;
}
