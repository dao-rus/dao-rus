import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminCrumbs } from "../../../../components/admin-crumbs";
import { CoreNavigation } from "../../../../components/core-navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { getGuardianDepartures, departureDate, departurePeople, departuresInPeriod } from "../../../../lib/guardian-departures";
import { departureHandle as handle, departureName } from "../../../../lib/departure-names";
import { readInterfaceTexts } from "../../../../lib/interface-texts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "История убытия" };
export default async function GuardianDeparturesPage({ searchParams }: { searchParams?: Promise<{ from?: string; to?: string }> } = {}) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const [departures, { values: texts }] = await Promise.all([getGuardianDepartures(), readInterfaceTexts()]);
  const params = await searchParams ?? {};
  const period = { from: departureDate(params.from), to: departureDate(params.to) };
  const events = departuresInPeriod(departures.events, period);
  const months = new Map<string, typeof events>();
  for (const event of events) {
    const month = event.observedAt.toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" }).slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), event]);
  }
  return <main className="shell"><section className="card profile">
    <CoreNavigation />
    <AdminCrumbs href="/admin/guardian/departures" />
    <h1>{texts["guardian.departures_title"]}</h1>
    <p>{texts["guardian.departures_recent"]} <strong>{departures.last30Days}</strong></p>
    <p>{texts["guardian.departures_total"]} <strong>{departures.total}</strong></p>
    <form method="get">
      <label>{texts["guardian.departures_from"]} <input type="date" name="from" defaultValue={period.from} /></label>
      <label>{texts["guardian.departures_to"]} <input type="date" name="to" defaultValue={period.to} /></label>
      <button type="submit">{texts["guardian.departures_filter"]}</button>
    </form>
    {period.from || period.to ? <p>{texts["guardian.departures_period"]} <strong>{departurePeople(events)}</strong></p> : null}
    {events.length ? [...months].map(([month, entries]) => <section key={month}>
      <h2>{entries[0].observedAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", month: "long", year: "numeric" }).replace(/^./u, letter => letter.toUpperCase())}</h2>
      <ul>{entries.map(event => <li key={event.id}>
      <time dateTime={event.observedAt.toISOString()}>{event.observedAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "long" })}</time>
      {" · "}{event.participantId ? <Link href={`/profile/${event.participantId}`}>{departureName(event) ?? texts["guardian.profile_unavailable"]}</Link> : texts["guardian.profile_unavailable"]}
      {event.archivedDisplayName && event.archivedDisplayName !== departureName(event) ? <> · {event.archivedDisplayName}</> : null}
      {handle(event) ? <> · {handle(event)}</> : null}
      {event.joinedAt ? <> · {texts["profile.forum_since"]} {event.joinedAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "long" })}</> : null}
      {" · "}{texts[event.type === "forum.left" ? "guardian.departure_left" : "guardian.departure_removed"]}
    </li>)}</ul></section>) : <p className="muted">{texts["guardian.departures_empty"]}</p>}
  </section></main>;
}
