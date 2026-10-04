import { getGuardianAudienceWithDatabase } from "./guardian-audience";
import { GuardianCampaignValidationError, parseGuardianCampaignDraft, PROFILE_INTERESTS_SCENARIO, type GuardianCampaignDraft } from "./guardian-campaign-input";

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
type Client = { query(text: string, values?: unknown[]): Promise<QueryResult>; release(): void };
export type GuardianCampaignDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<Client>;
};

const AUDIENCE_RULE = {
  current: "forum_joined_or_logged_in",
  excludeMembershipStatuses: ["left", "excluded"],
  excludeRosterBots: true,
  interests: "none_at_any_visibility",
};

export type GuardianCampaignSnapshot = GuardianCampaignDraft & {
  id: string;
  actionLabel: string;
  actionUrl: string;
  createdAt: Date;
  recipientCount: number;
  telegramDeliveryCount: number;
  createdByParticipantId: string;
};

function snapshot(row: Record<string, unknown>): GuardianCampaignSnapshot {
  return {
    id: String(row.id),
    text: String(row.text),
    actionLabel: String(row.action_label),
    actionUrl: String(row.action_url),
    createdAt: new Date(String(row.created_at)),
    recipientCount: Number(row.recipient_count),
    telegramDeliveryCount: Number(row.telegram_delivery_count),
    createdByParticipantId: String(row.created_by_participant_id),
  };
}

async function campaignWithDatabase(database: Pick<GuardianCampaignDatabase, "query">): Promise<GuardianCampaignSnapshot | null> {
  const result = await database.query(
    `SELECT id, text, action_label, action_url, created_at, recipient_count,
            telegram_delivery_count, created_by_participant_id
       FROM guardian_campaigns WHERE campaign_key = $1`,
    [PROFILE_INTERESTS_SCENARIO.key],
  );
  return result.rowCount ? snapshot(result.rows[0]) : null;
}

export async function getProfileInterestsCampaignWithDatabase(
  database: Pick<GuardianCampaignDatabase, "query">,
): Promise<GuardianCampaignSnapshot | null> {
  return campaignWithDatabase(database);
}

async function telegramRecipients(client: Client, participantIds: string[]): Promise<string[]> {
  if (!participantIds.length) return [];
  const result = await client.query(
    `SELECT identity.participant_id, identity.external_user_id,
            EXISTS (
              SELECT 1 FROM external_identities other
               WHERE other.provider = 'telegram' AND other.id <> identity.id
                 AND (other.external_user_id = identity.external_user_id
                   OR other.provider_subject = 'roster:' || identity.external_user_id)
            ) OR EXISTS (
              SELECT 1 FROM telegram_roster_entries roster
               WHERE roster.telegram_user_id::text = identity.external_user_id
                 AND roster.participant_id IS NOT NULL
                 AND roster.participant_id <> identity.participant_id
            ) OR (identity.provider_subject LIKE 'roster:%'
              AND identity.provider_subject <> 'roster:' || identity.external_user_id) AS identity_conflict
       FROM external_identities identity
      WHERE identity.provider = 'telegram' AND identity.participant_id = ANY($1::uuid[])`,
    [participantIds],
  );
  const identities = new Map<string, Array<Record<string, unknown>>>();
  for (const row of result.rows) {
    const id = String(row.participant_id);
    identities.set(id, [...(identities.get(id) ?? []), row]);
  }
  return participantIds.filter((id) => {
    const rows = identities.get(id);
    if (rows?.length !== 1 || rows[0].identity_conflict === true) return false;
    const telegramId = rows[0].external_user_id;
    return typeof telegramId === "string" && /^[1-9]\d*$/u.test(telegramId)
      && Number.isSafeInteger(Number(telegramId));
  });
}

export async function launchProfileInterestsCampaignWithDatabase(
  database: Pick<GuardianCampaignDatabase, "connect">,
  adminId: string,
  draft: GuardianCampaignDraft,
): Promise<{ campaign: GuardianCampaignSnapshot; launched: boolean }> {
  const validated = parseGuardianCampaignDraft(draft);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(42008, hashtext($1::text))", [PROFILE_INTERESTS_SCENARIO.key]);
    const existing = await campaignWithDatabase(client);
    if (existing) {
      await client.query("COMMIT");
      return { campaign: existing, launched: false };
    }

    // Reuse Guardian's current-participant and any-visibility interest semantics at launch time.
    const overview = await getGuardianAudienceWithDatabase(client);
    const recipientIds = [...new Set(overview.missingInterests.map((person) => person.id))];
    if (!recipientIds.length) throw new GuardianCampaignValidationError("Campaign audience is empty");
    const telegramIds = await telegramRecipients(client, recipientIds);
    const inserted = await client.query(
      `INSERT INTO guardian_campaigns(campaign_key, campaign_type, text, action_label,
           action_url, audience_rule, created_by_participant_id, recipient_count, telegram_delivery_count)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::uuid, $8, $9)
       ON CONFLICT (campaign_key) DO NOTHING
       RETURNING id, text, action_label, action_url, created_at, recipient_count,
                 telegram_delivery_count, created_by_participant_id`,
      [PROFILE_INTERESTS_SCENARIO.key, PROFILE_INTERESTS_SCENARIO.type,
        validated.text, PROFILE_INTERESTS_SCENARIO.actionLabel, PROFILE_INTERESTS_SCENARIO.actionUrl, JSON.stringify(AUDIENCE_RULE),
        adminId, recipientIds.length, telegramIds.length],
    );
    if (!inserted.rowCount) throw new Error("Campaign key changed during locked launch");
    const campaign = snapshot(inserted.rows[0]);
    const notifications = await client.query(
      `INSERT INTO notifications(campaign_id, participant_id, notification_type, text,
           action_label, action_url, source_type, created_by_participant_id)
       SELECT $1::uuid, recipient.recipient_id, $3, $4, $5, $6,
              'admin', $7::uuid
         FROM unnest($2::uuid[]) AS recipient(recipient_id)
       RETURNING id`,
      [campaign.id, recipientIds, PROFILE_INTERESTS_SCENARIO.notificationType, validated.text,
        PROFILE_INTERESTS_SCENARIO.actionLabel, PROFILE_INTERESTS_SCENARIO.actionUrl, adminId],
    );
    if (notifications.rowCount !== recipientIds.length) throw new Error("Campaign notification count mismatch");
    const deliveries = await client.query(
      `INSERT INTO notification_deliveries(notification_id, channel, status)
       SELECT notification.id, 'telegram', 'pending'
         FROM notifications notification
        WHERE notification.campaign_id = $1::uuid
          AND notification.participant_id = ANY($2::uuid[])
       RETURNING id`,
      [campaign.id, telegramIds],
    );
    if (deliveries.rowCount !== telegramIds.length) throw new Error("Campaign delivery count mismatch");
    await client.query("COMMIT");
    return { campaign, launched: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getProfileInterestsCampaign() {
  const { pool } = await import("./db");
  return getProfileInterestsCampaignWithDatabase(pool);
}

export async function launchProfileInterestsCampaign(adminId: string, draft: GuardianCampaignDraft) {
  const { pool } = await import("./db");
  return launchProfileInterestsCampaignWithDatabase(pool, adminId, draft);
}
