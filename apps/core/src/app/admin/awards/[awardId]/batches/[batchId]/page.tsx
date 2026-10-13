import { notFound } from "next/navigation";
import { requireAwardAdmin, awardRouteId } from "@/lib/award-admin";
import { pool } from "@/lib/db";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { selectParticipantAudienceWithDatabase, audienceConditions, type AudienceFilters } from "@/lib/participant-audience";
import { AdminCrumbs } from "@/components/admin-crumbs";
import { AwardNotice } from "@/components/award-content";
import { AwardLink } from "@/components/award-link";
import { UserText } from "@/components/user-text";
import { LocalDateTime } from "@/components/local-date-time";
import { AwardCandidateSelection } from "@/components/award-candidate-selection";
import { validateAwardFilters } from "@/lib/award-batches";
export const dynamic = "force-dynamic";
export const metadata = { title: "Выпуск награды · Учредитель" };
export default async function AwardBatchPage({ params, searchParams }: {
    params: Promise<{
        awardId: string;
        batchId: string;
    }>;
    searchParams: Promise<{
        award_update?: string;
        search?: string; city?: string; interests?: string | string[]; conditions?: string | string[];
        verification?: string; membership?: string; joinedFrom?: string; joinedTo?: string;
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
    const draft = batch.status === "draft";
    let rule = batch.audience_rule as AudienceFilters, searchError = false;
    const array = (value: string | string[] | undefined) => value ? (Array.isArray(value) ? value : [value]) : [];
    if (draft && query.search === "1") {
        try { rule = validateAwardFilters({ city: query.city, interests: array(query.interests),
            conditions: array(query.conditions) as AudienceFilters["conditions"], verification: query.verification,
            membership: query.membership, joinedFrom: query.joinedFrom, joinedTo: query.joinedTo }); }
        catch { searchError = true; }
    }
    const options = draft ? await selectParticipantAudienceWithDatabase(pool, {}, "awards") : null;
    const results = draft && query.search === "1" && !searchError ? await selectParticipantAudienceWithDatabase(pool, rule, "awards") : null;
    const included = candidates.rows.filter(c => c.status === "included");
    const dates = new Map(options?.audience.map(p => [p.id, p.joinedOn]));
    if (draft && (rule.joinedFrom || rule.joinedTo)) included.sort((a, b) => {
      return (dates.get(String(a.participant_id)) ?? "9999").localeCompare(dates.get(String(b.participant_id)) ?? "9999")
        || String(a.display_name).localeCompare(String(b.display_name), "ru") || String(a.participant_id).localeCompare(String(b.participant_id));
    });
    const statusByPerson = new Map(included.map(c => [String(c.participant_id), String(c.status)]));
    const dateSource = (person: { joinedSource?: string | null; joinedApproximate?: boolean }) =>
        person.joinedSource === "telegram_export" ? texts[person.joinedApproximate ? "award.joinApproximate" : "award.joinExport"]
        : person.joinedSource === "chat_member" ? texts["award.joinWebhook"] : texts["award.joinUnknown"];
    const fields = Object.entries(rule).flatMap(([name, value]) => (Array.isArray(value) ? value : value ? [value] : []).map(value => ({ name, value: String(value) })));
    const selectionLabels = { name: texts["award.person"], date: texts["award.joinDate"], source: texts["award.joinSource"], status: texts["award.selectionStatus"],
        unknown: texts["award.joinUnknown"], selectAll: texts["award.selectPage"], deselect: texts["award.deselect"], selected: texts["award.selectedCount"],
        confirm: texts["award.removeConfirm"], empty: texts["award.searchEmpty"] };
    // What exactly blocks the release, counted on the same rows the table below shows.
    const missingReason = included.filter(c => !String(c.reason).trim()).length;
    const conflicting = included.filter(c => c.instance_id).length;
    const canFinalize = included.length > 0 && !missingReason && !conflicting;
    const blockedReasons = [
        included.length ? null : texts["award.blockedEmpty"],
        missingReason ? texts["award.blockedReason"].replace("{count}", String(missingReason)) : null,
        conflicting ? texts["award.blockedConflict"].replace("{count}", String(conflicting)) : null,
    ].filter((line): line is string => Boolean(line));
    const hidden = (action: string) => <><input type="hidden" name="batchId" value={batchId}/><input type="hidden" name="action" value={action}/></>;
    const renderCandidate = (candidate: typeof candidates.rows[number]) => <article className="awardCandidate" key={candidate.id}>{!draft ? <h3>{candidate.display_name}</h3> : null}
      <p>{texts["award.source"]}: {texts[`award.${candidate.source as "filter" | "manual"}`]}</p>
      {draft ? <><details><summary>{texts["award.editCandidate"]}</summary><p className="formError">{candidate.instance_id ? texts["award.conflict"] : null}</p><form className="awardForm" action="/api/admin/awards/batches" method="post">{hidden("edit")}<input type="hidden" name="candidateId" value={candidate.id}/>
        <input type="hidden" name="status" value="included"/>
        <label>{texts["award.reason"]}<textarea name="reason" defaultValue={candidate.reason} maxLength={2000}/></label>
        <label>{texts["award.personalAddress"]}<textarea name="personalAddress" defaultValue={candidate.personal_address} maxLength={10000}/></label>
        <button type="submit" className="button secondary">{texts["award.save"]}</button></form></details>
        <form action="/api/admin/awards/batches" method="post">{hidden("remove_selected")}<input type="hidden" name="candidateIds" value={candidate.id}/><input type="hidden" name="confirm" value="on"/>
          <button type="submit" className="button secondary">{texts["award.removeOne"]}</button></form></> : <>
        <h4>{texts["award.reason"]}</h4><UserText text={candidate.reason}/><h4>{texts["award.personalAddress"]}</h4><UserText text={candidate.personal_address}/>
        {candidate.instance_batch === batchId ? <><p>{texts[`award.${candidate.instance_status as "offered" | "declined" | "accepted" | "rejected"}`]}</p>
          {([['offered_at', 'offeredAt'], ['declined_at', 'declinedAt'], ['accepted_at', 'acceptedAt'], ['rejected_at', 'rejectedAt']] as const).map(([column, key]) => candidate[column] ? <p key={column}>{texts[`award.${key}`]}: <LocalDateTime value={candidate[column].toISOString()}/></p> : null)}
          <AwardLink href={`/award-offers/${candidate.instance_id}`} label={texts["award.copy"]} copied={texts["award.copied"]}/></> : null}</>}
    </article>;
    return <main className="shell"><section className="card"><AdminCrumbs href="/admin/awards" trail={[{ label: batch.name, href: `/admin/awards/${awardId}` }, { label: texts[`award.${batch.kind as "regular" | "remint"}`] }]}/>
    <h1>{texts[`award.${batch.kind as "regular" | "remint"}`]} · {texts[`award.${draft ? "draft" : "finalized"}`]}</h1>
    <p><LocalDateTime value={batch.created_at.toISOString()}/>{batch.finalized_at ? <> · <LocalDateTime value={batch.finalized_at.toISOString()}/></> : null}</p>
    <AwardNotice notice={query.award_update} texts={texts}/>
    {draft && options ? <><h2>{texts["award.filters"]}</h2><p>{texts["award.searchHint"]}</p><form className="awardForm" method="get"><input type="hidden" name="search" value="1" />
      <label>{texts["award.joinFrom"]}<input type="date" name="joinedFrom" defaultValue={rule.joinedFrom || ""} /></label>
      <label>{texts["award.joinTo"]}<input type="date" name="joinedTo" defaultValue={rule.joinedTo || ""} /></label>
      <p className="muted">{texts["award.joinHint"]}</p>
      <label>{texts["award.city"]}<select name="city" defaultValue={rule.city || ""}><option value="">{texts["award.all"]}</option>{options.cities.map(city => <option key={city.key} value={city.key}>{city.residence.name}, {city.residence.country}</option>)}</select></label>
      <label>{texts["award.interests"]}<select multiple name="interests" defaultValue={rule.interests ?? []}>{options.interests.map(interest => <option key={interest.key} value={interest.key}>{interest.label}</option>)}</select></label>
      <label>{texts["award.verification"]}<select name="verification" defaultValue={rule.verification || ""}><option value="">{texts["award.all"]}</option><option value="verified">{texts["award.verified"]}</option><option value="unverified">{texts["award.unverified"]}</option></select></label>
      <label>{texts["award.membership"]}<select name="membership" defaultValue={rule.membership || ""}><option value="">{texts["award.all"]}</option>{(["none", "participant", "left", "excluded"] as const).map(value => <option key={value} value={value}>{texts[`award.${value === "excluded" ? "excludedMembership" : value}`]}</option>)}</select></label>
      <fieldset><legend>{texts["award.conditions"]}</legend>{audienceConditions.map(condition => <label key={condition}><input type="checkbox" name="conditions" value={condition} defaultChecked={rule.conditions?.includes(condition)}/>{texts[`award.${condition}`]}</label>)}</fieldset>
      <button className="button secondary" type="submit">{texts["award.findCandidates"]}</button></form>
      {searchError ? <p className="formError">{texts["award.invalid"]}</p> : null}
      {results ? <><h3>{texts["award.searchResults"]} ({results.audience.length})</h3>
        <AwardCandidateSelection key={JSON.stringify(rule)} batchId={batchId} action="add_selected" filters={fields}
          labels={{ ...selectionLabels, submit: texts["award.addSelected"] }} rows={results.audience.map(person => ({
            id: person.id, participantId: person.id, name: person.displayName, joinedOn: person.joinedOn ?? null, source: dateSource(person),
            status: statusByPerson.has(person.id) ? texts["award.included"] : texts["award.notAdded"],
            disabled: statusByPerson.has(person.id),
          }))} />
        {results.unknownDates.length > 0 ? <section><h3>{texts["award.unknownReview"]} ({results.unknownDates.length})</h3>
          <p className="muted">{texts["award.unknownReviewHint"]}</p>
          <div className="awardSelection"><div className="awardSelectionTable"><table><thead><tr><th>{texts["award.person"]}</th><th>{texts["award.joinDate"]}</th><th>{texts["award.selectionStatus"]}</th></tr></thead>
          <tbody>{results.unknownDates.map(person => <tr key={person.id}><td>{person.displayName}<br/><small>{person.id}</small></td><td>{texts["award.joinUnknown"]}</td>
            <td>{texts[statusByPerson.has(person.id) ? "award.included" : "award.notAdded"]}</td></tr>)}</tbody></table></div></div>
        </section> : null}</> : null}
      <form className="awardForm" action="/api/admin/awards/batches" method="post">{hidden("add")}<label>{texts["award.manual"]}<input name="participantId" list="award-participants" required placeholder="Participant UUID"/></label>
        <datalist id="award-participants">{options.audience.map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}</datalist><button type="submit" className="button secondary">{texts["award.manual"]}</button></form></> : null}
    <h2>{texts["award.currentCandidates"]} ({included.length})</h2>
    {draft && included.length > 0 ? <>
      <p className="muted">{texts["award.clearDraftHint"]}</p>
      <form className="awardForm" action="/api/admin/awards/batches" method="post">{hidden("clear")}
        <label><input type="checkbox" name="confirm" required />{texts["award.clearDraftConfirm"]}</label>
        <button className="button secondary" type="submit">{texts["award.clearDraft"]}</button>
      </form>
      <AwardCandidateSelection batchId={batchId} action="remove_selected" labels={{ ...selectionLabels, submit: texts["award.removeSelected"] }}
        rows={included.map(candidate => {
          const person = options?.audience.find(p => p.id === candidate.participant_id);
          return { id: String(candidate.id), participantId: String(candidate.participant_id), name: String(candidate.display_name), joinedOn: person?.joinedOn ?? null,
            source: person ? dateSource(person) : texts["award.joinUnknown"], status: texts["award.included"], details: renderCandidate(candidate) };
        })} />
    </> : null}

    {!draft ? included.map(renderCandidate) : null}
    {!draft ? <form className="awardForm" action="/api/admin/awards/batches" method="post">{hidden("notify")}
      <p>{texts["award.notifyHint"]}</p><button type="submit" className="button secondary">{texts["award.notify"]}</button></form> : null}
    {draft ? <section className="awardPreparation"><h2>{texts["award.prepareBatch"]}</h2><p>{texts["award.prepareHint"]}</p>
      {missingReason ? <form className="awardForm" action="/api/admin/awards/batches" method="post">{hidden("fill_reason")}
        <label>{texts["award.bulkReason"]}<textarea name="reason" required maxLength={2000}/></label>
        <p className="muted">{texts["award.bulkReasonHint"]}</p>
        <button type="submit" className="button secondary">{texts["award.bulkReasonApply"]}</button></form> : null}
      <div className="awardSelection"><div className="awardSelectionTable"><table><thead><tr><th>{texts["award.person"]}</th><th>{texts["award.reason"]}</th><th>{texts["award.selectionStatus"]}</th></tr></thead>
        <tbody>{included.map(candidate => <tr key={candidate.id}><td>{candidate.display_name}</td><td><UserText text={candidate.reason}/></td>
          <td>{candidate.instance_id ? texts["award.conflict"] : !String(candidate.reason).trim() ? texts["award.reasonMissing"] : texts["award.ready"]}</td></tr>)}</tbody></table></div></div>
      <form className="awardForm" action="/api/admin/awards/batches" method="post">{hidden("finalize")}
      <label><input type="checkbox" name="confirm" required/>{texts["award.finalizeWarning"]}</label><button type="submit" className="button primary" disabled={!canFinalize}>{texts["award.finalize"]}</button>
      {blockedReasons.map(line => <p className="formError" key={line}>{line}</p>)}</form></section> : null}
  </section></main>;
}
