import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminCrumbs } from "../../../../components/admin-crumbs";
import { CoreNavigation } from "../../../../components/core-navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { getGuardianDepartures, type GuardianDeparture } from "../../../../lib/guardian-departures";
import { readInterfaceTexts } from "../../../../lib/interface-texts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "История убытия" };
// The placeholder tells nothing about who left: fall back to anything the person is actually known by.
const PLACEHOLDER = "Участник форума";
function departureName(event: GuardianDeparture): string | null {
  const own = event.displayName && event.displayName !== PLACEHOLDER ? event.displayName : null;
  return own ?? event.telegramOwnName ?? event.archivedDisplayName
    ?? (event.telegramUsername ? `@${event.telegramUsername}` : null) ?? event.archivedUsername ?? event.displayName;
}
function handle(event: GuardianDeparture): string | null {
  const username = event.telegramUsername ? `@${event.telegramUsername}` : event.archivedUsername;
  return username && username !== departureName(event) ? username : null;
}

export default async function GuardianDeparturesPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const [departures, { values: texts }] = await Promise.all([getGuardianDepartures(), readInterfaceTexts()]);
  return <main className="shell"><section className="card profile">
    <CoreNavigation />
    <AdminCrumbs href="/admin/guardian/departures" />
    <h1>{texts["guardian.departures_title"]}</h1>
    <p>{texts["guardian.departures_recent"]} <strong>{departures.last30Days}</strong></p>
    <p>{texts["guardian.departures_total"]} <strong>{departures.total}</strong></p>
    {departures.events.length ? <ul>{departures.events.map(event => <li key={event.id}>
      <time dateTime={event.observedAt.toISOString()}>{event.observedAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</time>
      {" · "}{event.participantId ? <Link href={`/profile/${event.participantId}`}>{departureName(event) ?? texts["guardian.profile_unavailable"]}</Link> : texts["guardian.profile_unavailable"]}
      {event.archivedDisplayName && event.archivedDisplayName !== departureName(event) ? <> · {event.archivedDisplayName}</> : null}
      {handle(event) ? <> · {handle(event)}</> : null}
      {event.joinedAt ? <> · {texts["profile.forum_since"]} {event.joinedAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "long" })}</> : null}
      {" · "}{texts[event.type === "forum.left" ? "guardian.departure_left" : "guardian.departure_removed"]}
    </li>)}</ul> : <p className="muted">{texts["guardian.departures_empty"]}</p>}
  </section></main>;
}
