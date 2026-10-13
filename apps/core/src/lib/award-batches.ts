import { requireAwardCapability } from "./award-access";
import { selectParticipantAudienceWithDatabase, audienceConditions, type AudienceFilters } from "./participant-audience";
import { createNotificationWithDatabase } from "./notifications";
import { AwardConflictError, AwardNotFoundError, AwardTransitionError, AwardValidationError, id, text, transaction, type AwardDatabase, type AwardDatabaseClient } from "./awards";
export function validateAwardFilters(input: AudienceFilters): AudienceFilters {
    for (const value of [input.joinedFrom, input.joinedTo]) {
        if (value && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
            || !Number.isFinite(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value))
            throw new AwardValidationError("Invalid join date");
    }
    if (input.joinedFrom && input.joinedTo && input.joinedFrom > input.joinedTo) throw new AwardValidationError("Invalid join date range");
    if (input.city && (typeof input.city !== "string" || input.city.length > 1000))
        throw new AwardValidationError("Invalid city");
    if (input.interests && (!Array.isArray(input.interests) || input.interests.length > 100 || input.interests.some(v => typeof v !== "string" || v.length > 200)))
        throw new AwardValidationError("Invalid interests");
    if (input.conditions && (!Array.isArray(input.conditions) || input.conditions.some(v => !audienceConditions.includes(v))))
        throw new AwardValidationError("Invalid conditions");
    if (input.verification && !["verified", "unverified"].includes(input.verification))
        throw new AwardValidationError("Invalid verification");
    if (input.membership && !["none", "participant", "left", "excluded"].includes(input.membership))
        throw new AwardValidationError("Invalid membership");
    return { city: input.city || undefined, interests: input.interests ?? [], conditions: input.conditions ?? [], verification: input.verification || undefined, membership: input.membership || undefined,
        joinedFrom: input.joinedFrom || undefined, joinedTo: input.joinedTo || undefined };
}

function selectedIds(values: unknown[]): string[] {
    if (!Array.isArray(values) || !values.length || values.length > 5000) throw new AwardValidationError("Select candidates");
    return [...new Set(values.map(value => id(value)))];
}

export async function addSelectedAwardCandidatesWithDatabase(database: AwardDatabase, actorId: string, batchId: string, participantIds: unknown[], input: AudienceFilters) {
    const actor = id(actorId); requireAwardCapability(actor, "award.batch.edit");
    const selected = selectedIds(participantIds), filters = validateAwardFilters(input);
    return transaction(database, async client => {
        await lockDraft(client, batchId);
        const allowed = new Set((await selectParticipantAudienceWithDatabase(client, filters, "awards")).audience.map(p => p.id));
        if (selected.some(person => !allowed.has(person))) throw new AwardValidationError("Selection no longer matches search");
        const changed = await client.query(`INSERT INTO award_candidates(batch_id,participant_id,source)
          SELECT $1, person, 'filter' FROM unnest($2::uuid[]) person
          ON CONFLICT(batch_id,participant_id) DO UPDATE SET status='included'
          WHERE award_candidates.status='excluded' RETURNING id`, [batchId, selected]);
        await client.query("UPDATE award_batches SET audience_rule=$2::jsonb WHERE id=$1", [batchId, JSON.stringify(filters)]);
        if (changed.rowCount) await client.query(`INSERT INTO events(event_type,participant_id,payload)
          VALUES ('award.candidates_added',$1,$2::jsonb)`, [actor, JSON.stringify({ batch_id: batchId, candidate_ids: changed.rows.map(r => r.id) })]);
        return changed.rowCount ?? 0;
    });
}

// Clearing a draft is exclusion, never deletion: retain notes and candidate history.
export async function excludeAwardCandidatesWithDatabase(database: AwardDatabase, actorId: string, batchId: string, candidateIds: unknown[] | null) {
    const actor = id(actorId); requireAwardCapability(actor, "award.batch.edit");
    const selected = candidateIds === null ? null : selectedIds(candidateIds);
    return transaction(database, async client => {
        await lockDraft(client, batchId);
        if (selected) {
            const found = await client.query("SELECT id FROM award_candidates WHERE batch_id=$1 AND id=ANY($2::uuid[])", [batchId, selected]);
            if (found.rows.length !== selected.length) throw new AwardNotFoundError();
        }
        const changed = await client.query(`UPDATE award_candidates SET status='excluded'
          WHERE batch_id=$1 AND status='included' ${selected ? "AND id=ANY($2::uuid[])" : ""} RETURNING id`, selected ? [batchId, selected] : [batchId]);
        if (changed.rowCount) await client.query(`INSERT INTO events(event_type,participant_id,payload)
          VALUES ('award.candidates_excluded',$1,$2::jsonb)`, [actor, JSON.stringify({ batch_id: batchId, cleared: selected === null, candidate_ids: changed.rows.map(r => r.id) })]);
        return changed.rowCount ?? 0;
    });
}

export async function addSelectedAwardCandidates(actor: string, batch: string, people: unknown[], filters: AudienceFilters) {
    const { pool } = await import("./db"); return addSelectedAwardCandidatesWithDatabase(pool, actor, batch, people, filters);
}
export async function excludeAwardCandidates(actor: string, batch: string, candidates: unknown[] | null) {
    const { pool } = await import("./db"); return excludeAwardCandidatesWithDatabase(pool, actor, batch, candidates);
}
async function lockDraft(client: AwardDatabaseClient, batchId: string) {
    const result = await client.query("SELECT * FROM award_batches WHERE id=$1 FOR UPDATE", [id(batchId)]);
    if (!result.rowCount)
        throw new AwardNotFoundError();
    if (result.rows[0].status !== "draft")
        throw new AwardTransitionError("Batch already finalized");
    return result.rows[0];
}
export async function createAwardBatchWithDatabase(database: AwardDatabase, actorId: string, awardId: string, kind: "regular" | "remint") {
    const actor = id(actorId);
    requireAwardCapability(actor, "award.batch.create");
    if (kind !== "regular" && kind !== "remint")
        throw new AwardValidationError("Invalid batch kind");
    return transaction(database, async (client) => {
        const award = await client.query("SELECT kind FROM awards WHERE id=$1", [id(awardId)]);
        if (!award.rowCount)
            throw new AwardNotFoundError();
        if (kind === "remint" && award.rows[0].kind !== "historical")
            throw new AwardValidationError("Only historical awards allow remint");
        return (await client.query("INSERT INTO award_batches(award_id,created_by_participant_id,kind) VALUES ($1,$2,$3) RETURNING *", [awardId, actor, kind])).rows[0];
    });
}
export async function snapshotAwardAudienceWithDatabase(database: AwardDatabase, actorId: string, batchId: string, input: AudienceFilters) {
    requireAwardCapability(id(actorId), "award.batch.edit");
    const filters = validateAwardFilters(input);
    return transaction(database, async (client) => {
        await lockDraft(client, batchId);
        const selected = await selectParticipantAudienceWithDatabase(client, filters, "awards");
        await client.query(`INSERT INTO award_candidates(batch_id,participant_id,source)
      SELECT $1, participant, 'filter' FROM unnest($2::uuid[]) participant
      ON CONFLICT(batch_id,participant_id) DO NOTHING`, [batchId, selected.audience.map(p => p.id)]);
        await client.query("UPDATE award_batches SET audience_rule=$2::jsonb WHERE id=$1", [batchId, JSON.stringify(filters)]);
        return selected.audience.length;
    });
}
export async function addAwardCandidateWithDatabase(database: AwardDatabase, actorId: string, batchId: string, participantId: string) {
    requireAwardCapability(id(actorId), "award.batch.edit");
    const recipient = id(participantId);
    return transaction(database, async (client) => {
        await lockDraft(client, batchId);
        if (!(await client.query("SELECT id FROM participants WHERE id=$1", [recipient])).rowCount)
            throw new AwardNotFoundError("Participant not found");
        await client.query("INSERT INTO award_candidates(batch_id,participant_id,source) VALUES ($1,$2,'manual') ON CONFLICT(batch_id,participant_id) DO UPDATE SET status='included' WHERE award_candidates.status='excluded'", [batchId, recipient]);
    });
}
export async function editAwardCandidateWithDatabase(database: AwardDatabase, actorId: string, batchId: string, candidateId: string, input: {
    status: unknown;
    reason: unknown;
    personalAddress: unknown;
}) {
    requireAwardCapability(id(actorId), "award.batch.edit");
    if (input.status !== "included" && input.status !== "excluded")
        throw new AwardValidationError("Invalid candidate status");
    const values = [id(candidateId), id(batchId), input.status, text(input.reason, "reason", 2000, true), text(input.personalAddress, "personal address", 10000, true)];
    return transaction(database, async (client) => {
        await lockDraft(client, batchId);
        if (!(await client.query("UPDATE award_candidates SET status=$3,reason=$4,personal_address=$5 WHERE id=$1 AND batch_id=$2 RETURNING id", values)).rowCount)
            throw new AwardNotFoundError();
    });
}
export async function finalizeAwardBatchWithDatabase(database: AwardDatabase, actorId: string, batchId: string) {
    const actor = id(actorId);
    requireAwardCapability(actor, "award.batch.finalize");
    return transaction(database, async (client) => {
        const result = await client.query("SELECT * FROM award_batches WHERE id=$1 FOR UPDATE", [id(batchId)]);
        if (!result.rowCount)
            throw new AwardNotFoundError();
        const batch = result.rows[0];
        if (batch.status === "finalized")
            return (await client.query("SELECT id,participant_id FROM award_instances WHERE batch_id=$1 ORDER BY participant_id", [batchId])).rows;
        // Serialize releases of the same Award, including concurrent batches.
        await client.query("SELECT id FROM awards WHERE id=$1 FOR UPDATE", [batch.award_id]);
        const candidates = (await client.query("SELECT c.*,i.id AS existing_instance_id FROM award_candidates c LEFT JOIN award_instances i ON i.award_id=$2 AND i.participant_id=c.participant_id WHERE c.batch_id=$1 AND c.status='included' ORDER BY c.participant_id", [batchId, batch.award_id])).rows;
        if (!candidates.length || candidates.some(c => !String(c.reason).trim()))
            throw new AwardValidationError("Every included candidate needs a reason");
        if (candidates.some(c => c.existing_instance_id))
            throw new AwardConflictError("Participant already has this award; exclude the conflicting candidate");
        try {
            await client.query(`INSERT INTO award_instances(award_id,participant_id,awarded_by_participant_id,reason,personal_address,batch_id)
        SELECT $2,participant_id,$3,reason,personal_address,batch_id FROM award_candidates WHERE batch_id=$1 AND status='included'`, [batchId, batch.award_id, actor]);
        }
        catch (error) {
            if ((error as {
                code?: string;
            }).code === "23505")
                throw new AwardConflictError("Participant already has this award");
            throw error;
        }
        await client.query("UPDATE award_batches SET status='finalized',finalized_by_participant_id=$2 WHERE id=$1", [batchId, actor]);
        return (await client.query("SELECT id,participant_id FROM award_instances WHERE batch_id=$1 ORDER BY participant_id", [batchId])).rows;
    });
}
export type AwardNotifyTexts = {
    text: string;
    action: string;
};
// Delivery is a separate, repeatable step after finalization: the batch row is locked, and a
// recipient who already has this offer's notice (or has answered the offer) is skipped, so a retry
// or a double click never sends twice. The notice carries only the public award name; the reason
// and the personal address stay on the recipient's own page.
export async function notifyAwardBatchRecipientsWithDatabase(database: AwardDatabase, actorId: string, batchId: string, texts: AwardNotifyTexts): Promise<number> {
    const actor = id(actorId);
    requireAwardCapability(actor, "award.offer");
    const batch = id(batchId);
    return transaction(database, async (client) => {
        const found = await client.query("SELECT b.status, a.name FROM award_batches b JOIN awards a ON a.id=b.award_id WHERE b.id=$1 FOR UPDATE OF b", [batch]);
        if (!found.rowCount)
            throw new AwardNotFoundError();
        if (found.rows[0].status !== "finalized")
            throw new AwardTransitionError("Recipients can be notified only after finalization");
        const body = texts.text.replaceAll("{name}", String(found.rows[0].name));
        const pending = await client.query(`SELECT i.id, i.participant_id FROM award_instances i
      WHERE i.batch_id=$1 AND i.status='offered'
        AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.participant_id=i.participant_id
          AND n.notification_type='award.offered' AND n.action_url='/award-offers/' || i.id::text)
      ORDER BY i.participant_id`, [batch]);
        // The notices join this transaction, so a rolled-back run leaves nothing half-sent.
        const joined = { connect: async () => ({
                query: (sql: string, values?: unknown[]) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)
                    ? Promise.resolve({ rowCount: 0, rows: [] }) : client.query(sql, values),
                release() { },
            }) };
        for (const row of pending.rows)
            await createNotificationWithDatabase(joined, { participantId: String(row.participant_id), notificationType: "award.offered", text: body,
                actionUrl: `/award-offers/${row.id}`, actionLabel: texts.action, sourceType: "admin", createdByParticipantId: actor, queueTelegram: true });
        return pending.rows.length;
    });
}
export async function notifyAwardBatchRecipients(actor: string, batch: string, texts: AwardNotifyTexts) { const { pool } = await import("./db"); return notifyAwardBatchRecipientsWithDatabase(pool, actor, batch, texts); }
export async function createAwardBatch(actor: string, award: string, kind: "regular" | "remint") { const { pool } = await import("./db"); return createAwardBatchWithDatabase(pool, actor, award, kind); }
export async function snapshotAwardAudience(actor: string, batch: string, filters: AudienceFilters) { const { pool } = await import("./db"); return snapshotAwardAudienceWithDatabase(pool, actor, batch, filters); }
export async function addAwardCandidate(actor: string, batch: string, participant: string) { const { pool } = await import("./db"); return addAwardCandidateWithDatabase(pool, actor, batch, participant); }
export async function editAwardCandidate(actor: string, batch: string, candidate: string, input: Parameters<typeof editAwardCandidateWithDatabase>[4]) { const { pool } = await import("./db"); return editAwardCandidateWithDatabase(pool, actor, batch, candidate, input); }
export async function finalizeAwardBatch(actor: string, batch: string) { const { pool } = await import("./db"); return finalizeAwardBatchWithDatabase(pool, actor, batch); }
