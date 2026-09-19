import {
  ParticipantRegistryIntegrityError,
  ParticipantRegistryNotFoundError,
  ParticipantRegistryValidationError,
  type ParticipantRegistryDatabase,
  type ParticipantRegistryDatabaseClient,
} from "./participant-registry";

const POSTGRES_BIGINT_MAX = BigInt("9223372036854775807");

export type MembershipBindingRepairResult = {
  repaired: boolean;
  participantId: string;
  evidenceEventId: number;
};

type MembershipEvidence = {
  id: number;
  changedByParticipantId: string;
  occurredAt: string;
  oldStatus: "unknown";
};

function normalizeTelegramUserId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new ParticipantRegistryValidationError("Invalid Telegram user ID");
  }
  if (BigInt(value) > POSTGRES_BIGINT_MAX) {
    throw new ParticipantRegistryValidationError("Invalid Telegram user ID");
  }
  return value;
}

function payloadFromRow(row: Record<string, unknown>): Record<string, unknown> {
  return row.payload && typeof row.payload === "object"
    ? row.payload as Record<string, unknown>
    : {};
}

async function verifiedMembershipEvidence(
  client: ParticipantRegistryDatabaseClient,
  telegramUserId: string,
): Promise<MembershipEvidence> {
  const result = await client.query(
    `SELECT id, participant_id, payload, created_at::text AS occurred_at
       FROM events
      WHERE event_type = 'participant_registry.membership_status_changed'
        AND payload->>'telegram_user_id' = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE`,
    [telegramUserId],
  );
  if (!result.rowCount) {
    throw new ParticipantRegistryIntegrityError(
      `No membership evidence exists for Telegram roster entry ${telegramUserId}`,
    );
  }

  const row = result.rows[0];
  const payload = payloadFromRow(row);
  const eventParticipantId = row.participant_id
    ? String(row.participant_id)
    : null;
  const changedByParticipantId = payload.changed_by_participant_id
    ? String(payload.changed_by_participant_id)
    : null;
  const occurredAt = String(row.occurred_at ?? "");

  if (
    String(payload.telegram_user_id ?? "") !== telegramUserId ||
    payload.old_value !== "unknown" ||
    payload.new_value !== "participant" ||
    !eventParticipantId ||
    changedByParticipantId !== eventParticipantId ||
    Number.isNaN(Date.parse(occurredAt))
  ) {
    throw new ParticipantRegistryIntegrityError(
      `Latest membership evidence is invalid for Telegram roster entry ${telegramUserId}`,
    );
  }

  return {
    id: Number(row.id),
    changedByParticipantId,
    occurredAt,
    oldStatus: "unknown",
  };
}

export async function repairMembershipBindingWithDatabase(
  database: ParticipantRegistryDatabase,
  changedByParticipantId: string,
  telegramUserIdValue: unknown,
): Promise<MembershipBindingRepairResult> {
  const telegramUserId = normalizeTelegramUserId(telegramUserIdValue);
  const client = await database.connect();

  try {
    await client.query("BEGIN");
    const rosterResult = await client.query(
      `SELECT membership_status,
              participant_id,
              display_name,
              username
         FROM telegram_roster_entries
        WHERE telegram_user_id = $1::bigint
        FOR UPDATE`,
      [telegramUserId],
    );
    if (!rosterResult.rowCount) throw new ParticipantRegistryNotFoundError();

    const roster = rosterResult.rows[0];
    if (roster.membership_status !== "participant") {
      throw new ParticipantRegistryIntegrityError(
        `Membership binding repair requires roster status participant for Telegram user ${telegramUserId}`,
      );
    }

    const evidence = await verifiedMembershipEvidence(client, telegramUserId);
    const rosterParticipantId = roster.participant_id
      ? String(roster.participant_id)
      : null;
    const identityResult = await client.query(
      `SELECT id, participant_id, external_user_id
         FROM external_identities
        WHERE provider = 'telegram'
          AND (
            external_user_id = $1
            OR ($2::uuid IS NOT NULL AND participant_id = $2::uuid)
          )
        FOR UPDATE`,
      [telegramUserId, rosterParticipantId],
    );
    const userIdentity = identityResult.rows.find(
      (row) => String(row.external_user_id) === telegramUserId,
    );
    const participantIdentity = rosterParticipantId
      ? identityResult.rows.find(
          (row) => String(row.participant_id) === rosterParticipantId,
        )
      : undefined;
    const identityParticipantId = userIdentity
      ? String(userIdentity.participant_id)
      : participantIdentity
        ? String(participantIdentity.participant_id)
        : null;

    if (
      rosterParticipantId &&
      identityParticipantId &&
      rosterParticipantId !== identityParticipantId
    ) {
      throw new ParticipantRegistryIntegrityError(
        `Telegram roster entry ${telegramUserId} is linked to Participant ${rosterParticipantId}, but Telegram identity belongs to Participant ${identityParticipantId}`,
      );
    }
    if (
      participantIdentity?.external_user_id &&
      String(participantIdentity.external_user_id) !== telegramUserId
    ) {
      throw new ParticipantRegistryIntegrityError(
        `Participant ${rosterParticipantId} already has a different Telegram identity`,
      );
    }

    let participantId = rosterParticipantId ?? identityParticipantId;
    let participantCreated = false;
    let canonicalStatusBefore: string = "missing";
    if (participantId) {
      const participantResult = await client.query(
        `SELECT membership_status
           FROM participants
          WHERE id = $1
          FOR UPDATE`,
        [participantId],
      );
      if (!participantResult.rowCount) {
        throw new ParticipantRegistryIntegrityError(
          `Canonical Participant ${participantId} does not exist`,
        );
      }
      const status = String(participantResult.rows[0].membership_status);
      if (!["none", "participant", "left", "excluded"].includes(status)) {
        throw new ParticipantRegistryIntegrityError(
          `Canonical Participant ${participantId} has unsupported membership status ${status}`,
        );
      }
      canonicalStatusBefore = status;
      if (canonicalStatusBefore === "left" || canonicalStatusBefore === "excluded") {
        throw new ParticipantRegistryIntegrityError(
          `Membership binding repair cannot overwrite canonical status ${canonicalStatusBefore} for Participant ${participantId}`,
        );
      }
    }

    const alreadyCorrect = Boolean(
      participantId &&
      rosterParticipantId === participantId &&
      userIdentity &&
      String(userIdentity.participant_id) === participantId &&
      canonicalStatusBefore === "participant",
    );
    if (alreadyCorrect) {
      await client.query("COMMIT");
      return {
        repaired: false,
        participantId: participantId!,
        evidenceEventId: evidence.id,
      };
    }

    const repairHistory = await client.query(
      `SELECT id, event_type
         FROM events
        WHERE (
          event_type = 'membership.joined'
          AND payload->>'telegram_user_id' = $1
        ) OR (
          event_type = 'participant_registry.membership_binding_repaired'
          AND payload->>'evidence_event_id' = $2
        )
        FOR UPDATE`,
      [telegramUserId, String(evidence.id)],
    );
    if (repairHistory.rowCount) {
      throw new ParticipantRegistryIntegrityError(
        `Membership repair history already exists for inconsistent Telegram roster entry ${telegramUserId}`,
      );
    }

    if (!participantId) {
      const participantResult = await client.query(
        `INSERT INTO participants(display_name, membership_status)
         VALUES ($1, 'none')
         RETURNING id`,
        [String(roster.display_name)],
      );
      participantId = String(participantResult.rows[0].id);
      participantCreated = true;
    }

    if (participantIdentity && !participantIdentity.external_user_id) {
      await client.query(
        `UPDATE external_identities
            SET external_user_id = $2,
                username = COALESCE($3, username),
                updated_at = now()
          WHERE id = $1`,
        [participantIdentity.id, telegramUserId, roster.username ?? null],
      );
    } else if (!userIdentity) {
      await client.query(
        `INSERT INTO external_identities(
           participant_id,
           provider,
           provider_subject,
           external_user_id,
           username
         ) VALUES ($1, 'telegram', $2, $3, $4)`,
        [
          participantId,
          `roster:${telegramUserId}`,
          telegramUserId,
          roster.username ?? null,
        ],
      );
    }

    if (!rosterParticipantId) {
      const rosterLinkResult = await client.query(
        `UPDATE telegram_roster_entries
            SET participant_id = $2
          WHERE telegram_user_id = $1::bigint
            AND participant_id IS NULL`,
        [telegramUserId, participantId],
      );
      if (rosterLinkResult.rowCount !== 1) {
        throw new ParticipantRegistryIntegrityError(
          `Telegram roster entry ${telegramUserId} changed during membership binding repair`,
        );
      }
    }

    if (canonicalStatusBefore !== "participant") {
      const canonicalUpdateResult = await client.query(
        `UPDATE participants
            SET membership_status = 'participant',
                updated_at = now()
          WHERE id = $1
            AND membership_status = 'none'`,
        [participantId],
      );
      if (canonicalUpdateResult.rowCount !== 1) {
        throw new ParticipantRegistryIntegrityError(
          `Canonical membership changed during repair for Participant ${participantId}`,
        );
      }
    }

    if (participantCreated) {
      await client.query(
        `INSERT INTO events(event_type, participant_id, payload)
         VALUES ('participant.created', $1, $2::jsonb)`,
        [
          participantId,
          JSON.stringify({
            source: "participant_registry_repair",
            telegram_user_id: telegramUserId,
            evidence_event_id: evidence.id,
          }),
        ],
      );
    }

    await client.query(
      `INSERT INTO events(event_type, participant_id, payload, created_at)
       VALUES ('membership.joined', $1, $2::jsonb, $3::timestamptz)`,
      [
        participantId,
        JSON.stringify({
          participant_id: participantId,
          old_status: evidence.oldStatus,
          new_status: "participant",
          changed_by_participant_id: evidence.changedByParticipantId,
          telegram_user_id: telegramUserId,
          source: "participant_registry_repair",
          evidence_event_id: evidence.id,
          occurred_at: evidence.occurredAt,
        }),
        evidence.occurredAt,
      ],
    );

    const repairedAt = new Date().toISOString();
    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ('participant_registry.membership_binding_repaired', $1, $2::jsonb)`,
      [
        changedByParticipantId,
        JSON.stringify({
          telegram_user_id: telegramUserId,
          evidence_event_id: evidence.id,
          changed_by_participant_id: changedByParticipantId,
          repaired_at: repairedAt,
          before: {
            roster_participant_id: rosterParticipantId,
            identity_participant_id: identityParticipantId,
            canonical_membership_status: canonicalStatusBefore,
          },
          participant_id: participantId,
          after: {
            roster_participant_id: participantId,
            identity_participant_id: participantId,
            canonical_membership_status: "participant",
          },
        }),
      ],
    );

    await client.query("COMMIT");
    return { repaired: true, participantId, evidenceEventId: evidence.id };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function repairMembershipBinding(
  changedByParticipantId: string,
  telegramUserId: unknown,
): Promise<MembershipBindingRepairResult> {
  const { pool } = await import("./db");
  return repairMembershipBindingWithDatabase(
    pool,
    changedByParticipantId,
    telegramUserId,
  );
}
