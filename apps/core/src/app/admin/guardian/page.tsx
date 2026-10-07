import Link from "next/link";
import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CoreNavigation } from "../../../components/core-navigation";
import { GuardianMessageComposer } from "../../../components/guardian-message-composer";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { getGuardianAudience, guardianAudienceConditions } from "../../../lib/guardian-audience";
import { getGuardianCampaignById, getGuardianOneShotCampaigns, technicalBroadcastCounts } from "../../../lib/guardian-campaign";
import { guardianScenarios } from "../../../lib/guardian-campaign-scenarios";
import { guardianSystemPresets } from "../../../lib/guardian-campaign-input";
import { residenceLabel } from "../../../lib/profile-about";
import { getGuardianDepartureSummary } from "../../../lib/guardian-departures";
import { readInterfaceTexts, type InterfaceTextKey } from "../../../lib/interface-texts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Хранитель" };
type SearchParams = { preset?: string; template?: string; condition?: string | string[]; city?: string; interest?: string | string[];
  message?: string; broadcast?: string; campaign_id?: string; scenario?: string };
export default async function GuardianPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const params = await searchParams;
  const [overview, departures, campaigns, result, { values: texts }] = await Promise.all([
    getGuardianAudience(), getGuardianDepartureSummary(), getGuardianOneShotCampaigns(),
    params.message || params.broadcast || params.campaign_id ? getGuardianCampaignById(params.message ?? params.broadcast ?? params.campaign_id!) : null,
    readInterfaceTexts(),
  ]);
  const labels = (key: string) => texts[("guardian." + key) as InterfaceTextKey];
  const conditions = typeof params.condition === "string" ? [params.condition] : params.condition ?? [];
  const presetConditions = { profile_residence_prompt: "without_residence", profile_interests_prompt: "without_interests", core_login_prompt: "never_logged_in" } as const;
  const templates = [...guardianSystemPresets, "town_meeting", "online_meeting"].map(key => {
    const scenario = guardianScenarios[key as keyof typeof guardianScenarios];
    const previous = campaigns.find(c => c.campaignType === key), counts = previous ? technicalBroadcastCounts(previous) : null;
    return { key, title: scenario.title, defaultText: scenario.defaultText, condition: Object.hasOwn(presetConditions, key)
      ? presetConditions[key as keyof typeof presetConditions] : key === "town_meeting" ? "city" : null,
      system: Object.hasOwn(presetConditions, key), core: key !== "core_login_prompt", telegram: true,
      previous: previous && counts ? { text: previous.text, recipients: counts.recipients, coreInbox: counts.coreInbox, telegramQueued: counts.telegramQueued } : null };
  });
  const selectedTemplate = params.preset ?? params.template ?? params.scenario ?? "";
  const summary = [
    { key: "without_residence", count: overview.missingCity.length, preset: "profile_residence_prompt" },
    { key: "without_interests", count: overview.missingInterests.length, preset: "profile_interests_prompt" },
    { key: "without_bio", count: overview.missingBio.length },
    { key: "never_logged_in", count: overview.neverLoggedIn.length, preset: "core_login_prompt" },
    { key: "unverified", count: overview.unverified.length },
  ];
  const resultCounts = result ? technicalBroadcastCounts(result) : null;
  return <main className="shell"><section className="card profile">
    <CoreNavigation />
    <div className="profileHeader"><div><div className="eyebrow">DAO Core</div><h1>Хранитель</h1></div>
      <div className="actions"><Link className="button secondary" href="/admin/guardian/forum">Форум и маршруты</Link>
        <Link className="button secondary" href="/admin">К управлению</Link></div></div>
    <h2>{texts["guardian.state_title"]}</h2>
    <table className="registryTable"><tbody>{summary.map(row => <tr key={row.key}>
      <td>{labels(row.key)}</td><td><strong>{row.count}</strong></td>
      <td><Link className="button secondary" href={"/admin/guardian?" + (row.preset ? "preset=" + row.preset : "condition=" + row.key) + "#guardian-composer"}>{texts["guardian.write"]}</Link></td>
    </tr>)}</tbody></table>
    <h2>Убытие</h2>
    <p>{texts["guardian.departures_recent"]} <strong>{departures.last30Days}</strong></p>
    <p>{texts["guardian.departures_total"]} <strong>{departures.total}</strong></p>
    <Link className="button secondary" href="/admin/guardian/departures">{texts["guardian.departures_title"]}</Link>
    <section id="guardian-composer"><h2>{texts["guardian.composer_title"]}</h2>
      <GuardianMessageComposer key={selectedTemplate + ":" + conditions.join(",")} templates={templates} selectedTemplate={selectedTemplate}
        initialConditions={conditions.filter(c => [...guardianAudienceConditions, "all_current", "city", "interests"].includes(c))}
        initialCity={params.city ?? ""} initialInterests={typeof params.interest === "string" ? [params.interest] : params.interest ?? []}
        cities={overview.cities.map(c => ({ key: c.key, label: residenceLabel(c.residence) + " (" + c.residence.type + ")" }))}
        interests={overview.interests} submissionId={randomUUID()}
        audiences={["all_current", ...guardianAudienceConditions, "city", "interests"].map(key => ({ key, label: labels(key) }))}
        texts={Object.fromEntries(Object.entries(texts).filter(([key]) => key.startsWith("guardian.")))} />
    </section>
    {resultCounts ? <section role="status" aria-label="Результат отправки">
      <p>{texts["guardian.result_recipients"]} <strong>{resultCounts.recipients}</strong></p>
      <p>{texts["guardian.result_core"]} <strong>{resultCounts.coreInbox}</strong></p>
      <p>{texts["guardian.result_telegram"]} <strong>{resultCounts.telegramQueued}</strong></p>
      <p>{texts["guardian.result_unavailable"]} <strong>{resultCounts.telegramUnavailable}</strong></p>
    </section> : null}
  </section></main>;
}
