import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAwardAdmin, awardRouteId } from "@/lib/award-admin";
import { pool } from "@/lib/db";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { selectParticipantAudienceWithDatabase, audienceConditions, type AudienceFilters } from "@/lib/participant-audience";
import { AwardNotice } from "@/components/award-content";
import { AwardLink } from "@/components/award-link";
import { UserText } from "@/components/user-text";
import { LocalDateTime } from "@/components/local-date-time";
export const dynamic = "force-dynamic";
export const metadata = { title: "Выпуск награды · Учредитель" };
export default async function AwardBatchPage({ params, searchParams }: {
    params: Promise<{
        awardId: string;
        batchId: string;
    }>;
    searchParams: Promise<{
        award_update?: string;
    }>;
}) {
    await requireAwardAdmin();
    const route = await params, awardId = awardRouteId(route.awardId), batchId = awardRouteId(route.batchId);
    const batch = (await pool.query("SELECT b.*,a.name FROM award_batches b JOIN awards a ON a.id=b.award_id WHERE b.id=$1 AND b.award_id=$2", [batchId, awardId])).rows[0];
    if (!batch)
        notFound();
    const [candidates, { values: texts }, query] = await Promise.all([
        pool.query(`SELECT c.*,p.display_name,i.id AS instance_id,i.batch_id AS instance_batch,i.status AS instance_status,
      i.offered_at,i.declined_at,i.accepted_at,i.rejected_at FROM award_candidates c JOIN participants p ON p.id=c.participant_id
      LEFT JOIN award_instances i ON i.award_id=$2 AND i.participant_id=c.participant_id WHERE c.batch_id=$1 ORDER BY lower(p.display_name),c.id`, [batchId, awardId]), readInterfaceTexts(), searchParams
    ]);
    const draft = batch.status === "draft", rule = batch.audience_rule as AudienceFilters;
    const options = draft ? await selectParticipantAudienceWithDatabase(pool, {}, "awards") : null;
    const canFinalize = candidates.rows.some(c => c.status === "included") && candidates.rows.every(c => c.status === "excluded" || (!c.instance_id && String(c.reason).trim()));
    const hidden = (action: string) => <><input type="hidden" name="batchId" value={batchId}/><input type="hidden" name="action" value={action}/></>;
    return <main className="shell"><section className="card"><Link href={`/admin/awards/${awardId}`}>{batch.name}</Link>
    <h1>{texts[`award.${batch.kind as "regular" | "remint"}`]} · {texts[`award.${draft ? "draft" : "finalized"}`]}</h1>
    <p><LocalDateTime value={batch.created_at.toISOString()}/>{batch.finalized_at ? <> · <LocalDateTime value={batch.finalized_at.toISOString()}/></> : null}</p>
    <AwardNotice notice={query.award_update} texts={texts}/>
    {draft && options ? <><h2>{texts["award.filters"]}</h2><p>{texts["award.filterHint"]}</p><form className="awardForm" action="/api/admin/awards/batches" method="post">{hidden("snapshot")}
      <label>{texts["award.city"]}<select name="city" defaultValue={rule.city || ""}><option value="">{texts["award.all"]}</option>{options.cities.map(city => <option key={city.key} value={city.key}>{city.residence.name}, {city.residence.country}</option>)}</select></label>
      <label>{texts["award.interests"]}<select multiple name="interests" defaultValue={rule.interests ?? []}>{options.interests.map(interest => <option key={interest.key} value={interest.key}>{interest.label}</option>)}</select></label>
      <label>{texts["award.verification"]}<select name="verification" defaultValue={rule.verification || ""}><option value="">{texts["award.all"]}</option><option value="verified">{texts["award.verified"]}</option><option value="unverified">{texts["award.unverified"]}</option></select></label>
      <label>{texts["award.membership"]}<select name="membership" defaultValue={rule.membership || ""}><option value="">{texts["award.all"]}</option>{(["none", "participant", "left", "excluded"] as const).map(value => <option key={value} value={value}>{texts[`award.${value === "excluded" ? "excludedMembership" : value}`]}</option>)}</select></label>
      <fieldset><legend>{texts["award.conditions"]}</legend>{audienceConditions.map(condition => <label key={condition}><input type="checkbox" name="conditions" value={condition} defaultChecked={rule.conditions?.includes(condition)}/>{texts[`award.${condition}`]}</label>)}</fieldset>
      <button className="button secondary" type="submit">{texts["award.snapshot"]}</button></form>
      <form className="awardForm" action="/api/admin/awards/batches" method="post">{hidden("add")}<label>{texts["award.manual"]}<input name="participantId" list="award-participants" required placeholder="Participant UUID"/></label>
        <datalist id="award-participants">{options.audience.map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}</datalist><button type="submit" className="button secondary">{texts["award.manual"]}</button></form></> : null}
    <h2>{texts["award.candidates"]} ({candidates.rows.length})</h2>
    {candidates.rows.map(candidate => <article className="awardCandidate" key={candidate.id}><h3>{candidate.display_name}</h3><p>{candidate.participant_id}</p>
      <p>{texts["award.source"]}: {texts[`award.${candidate.source as "filter" | "manual"}`]} · {texts[`award.${candidate.status as "included" | "excluded"}`]}</p>
      {draft ? <><p className="formError">{candidate.instance_id ? texts["award.conflict"] : null}</p><form className="awardForm" action="/api/admin/awards/batches" method="post">{hidden("edit")}<input type="hidden" name="candidateId" value={candidate.id}/>
        <select name="status" defaultValue={candidate.status}><option value="included">{texts["award.included"]}</option><option value="excluded">{texts["award.excluded"]}</option></select>
        <label>{texts["award.reason"]}<textarea name="reason" defaultValue={candidate.reason} maxLength={2000}/></label>
        <label>{texts["award.personalAddress"]}<textarea name="personalAddress" defaultValue={candidate.personal_address} maxLength={10000}/></label>
        <button type="submit" className="button secondary">{texts["award.save"]}</button></form></> : <>
        <h4>{texts["award.reason"]}</h4><UserText text={candidate.reason}/><h4>{texts["award.personalAddress"]}</h4><UserText text={candidate.personal_address}/>
        {candidate.instance_batch === batchId ? <><p>{texts[`award.${candidate.instance_status as "offered" | "declined" | "accepted" | "rejected"}`]}</p>
          {([['offered_at', 'offeredAt'], ['declined_at', 'declinedAt'], ['accepted_at', 'acceptedAt'], ['rejected_at', 'rejectedAt']] as const).map(([column, key]) => candidate[column] ? <p key={column}>{texts[`award.${key}`]}: <LocalDateTime value={candidate[column].toISOString()}/></p> : null)}
          <AwardLink href={`/award-offers/${candidate.instance_id}`} label={texts["award.copy"]} copied={texts["award.copied"]}/></> : null}</>}
    </article>)}
    {draft ? <form className="awardForm" action="/api/admin/awards/batches" method="post">{hidden("finalize")}
      <label><input type="checkbox" name="confirm" required/>{texts["award.finalizeWarning"]}</label><button type="submit" className="button primary" disabled={!canFinalize}>{texts["award.finalize"]}</button>
      {!canFinalize ? <p>{texts["award.invalid"]}</p> : null}</form> : null}
  </section></main>;
}
