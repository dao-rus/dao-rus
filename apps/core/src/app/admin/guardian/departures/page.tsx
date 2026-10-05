import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CoreNavigation } from "../../../../components/core-navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { getGuardianDepartures } from "../../../../lib/guardian-departures";
import { readInterfaceTexts } from "../../../../lib/interface-texts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "История убытия" };
export default async function GuardianDeparturesPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const [departures, { values: texts }] = await Promise.all([getGuardianDepartures(), readInterfaceTexts()]);
  return <main className="shell"><section className="card profile">
    <CoreNavigation />
    <h1>{texts["guardian.departures_title"]}</h1>
    <Link className="button secondary" href="/admin/guardian">{texts["guardian.back"]}</Link>
    <p>{texts["guardian.departures_recent"]} <strong>{departures.last30Days}</strong></p>
    <p>{texts["guardian.departures_total"]} <strong>{departures.total}</strong></p>
    {departures.events.length ? <ul>{departures.events.map(event => <li key={event.id}>
      <time dateTime={event.observedAt.toISOString()}>{event.observedAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</time>
      {" · "}{event.participantId ? <Link href={`/profile/${event.participantId}`}>{event.displayName ?? event.archivedDisplayName ?? event.archivedUsername ?? texts["guardian.profile_unavailable"]}</Link> : texts["guardian.profile_unavailable"]}
      {event.archivedDisplayName && event.archivedDisplayName !== event.displayName ? <> · {event.archivedDisplayName}</> : null}
      {event.archivedUsername ? <> · {event.archivedUsername}</> : null}
      {" · "}{texts[event.type === "forum.left" ? "guardian.departure_left" : "guardian.departure_removed"]}
    </li>)}</ul> : <p className="muted">{texts["guardian.departures_empty"]}</p>}
  </section></main>;
}
