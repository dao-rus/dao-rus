import { requireAwardCapability } from "./award-access";
import { selectParticipantAudienceWithDatabase, audienceConditions, type AudienceFilters } from "./participant-audience";
import { AwardConflictError, AwardNotFoundError, AwardTransitionError, AwardValidationError, id, text, transaction, type AwardDatabase, type AwardDatabaseClient } from "./awards";
export function validateAwardFilters(input: AudienceFilters): AudienceFilters {
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
    return { city: input.city || undefined, interests: input.interests ?? [], conditions: input.conditions ?? [], verification: input.verification || undefined, membership: input.membership || undefined };
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
        await client.query("INSERT INTO award_candidates(batch_id,participant_id,source) VALUES ($1,$2,'manual') ON CONFLICT(batch_id,participant_id) DO NOTHING", [batchId, recipient]);
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
export async function createAwardBatch(actor: string, award: string, kind: "regular" | "remint") { const { pool } = await import("./db"); return createAwardBatchWithDatabase(pool, actor, award, kind); }
export async function snapshotAwardAudience(actor: string, batch: string, filters: AudienceFilters) { const { pool } = await import("./db"); return snapshotAwardAudienceWithDatabase(pool, actor, batch, filters); }
export async function addAwardCandidate(actor: string, batch: string, participant: string) { const { pool } = await import("./db"); return addAwardCandidateWithDatabase(pool, actor, batch, participant); }
export async function editAwardCandidate(actor: string, batch: string, candidate: string, input: Parameters<typeof editAwardCandidateWithDatabase>[4]) { const { pool } = await import("./db"); return editAwardCandidateWithDatabase(pool, actor, batch, candidate, input); }
export async function finalizeAwardBatch(actor: string, batch: string) { const { pool } = await import("./db"); return finalizeAwardBatchWithDatabase(pool, actor, batch); }
