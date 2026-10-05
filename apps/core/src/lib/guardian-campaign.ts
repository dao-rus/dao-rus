import { randomUUID } from "node:crypto";
import { getGuardianCampaignRewardWithDatabase } from "./guardian-campaign-reward";
import { getGuardianAudienceWithDatabase } from "./guardian-audience";
import { GuardianCampaignValidationError, parseGuardianCampaignDraft, parseTechnicalBroadcastDraft, type TechnicalBroadcastDraft } from "./guardian-campaign-input";
import { guardianResidenceOptions, guardianScenario, guardianScenarios, resolveGuardianScenarioAudience, type GuardianScenarioType } from "./guardian-campaign-scenarios";

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
type Client = { query(text: string, values?: unknown[]): Promise<QueryResult>; release(): void };
export type GuardianCampaignDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<Client>;
};

export type GuardianCampaignSnapshot = {
  id: string;
  campaignKey: string;
  campaignType: GuardianScenarioType | "technical_broadcast";
  text: string;
  actionLabel: string | null;
  actionUrl: string | null;
  audienceRule: Record<string, unknown>;
  createdAt: Date;
  recipientCount: number;
  telegramDeliveryCount: number;
  createdByParticipantId: string;
};

function snapshot(row: Record<string, unknown>): GuardianCampaignSnapshot {
  return {
    id: String(row.id),
    campaignKey: String(row.campaign_key),
    campaignType: String(row.campaign_type) as GuardianCampaignSnapshot["campaignType"],
    text: String(row.text),
    actionLabel: row.action_label == null ? null : String(row.action_label),
    actionUrl: row.action_url == null ? null : String(row.action_url),
    audienceRule: row.audience_rule as Record<string, unknown>,
    createdAt: new Date(String(row.created_at)),
    recipientCount: Number(row.recipient_count),
    telegramDeliveryCount: Number(row.telegram_delivery_count),
    createdByParticipantId: String(row.created_by_participant_id),
  };
}

async function campaignWithDatabase(database: Pick<GuardianCampaignDatabase, "query">, key: string): Promise<GuardianCampaignSnapshot | null> {
  const result = await database.query(
    `SELECT id, campaign_key, campaign_type, text, action_label, action_url, audience_rule, created_at, recipient_count,
            telegram_delivery_count, created_by_participant_id
       FROM guardian_campaigns WHERE campaign_key = $1`,
    [key],
  );
  return result.rowCount ? snapshot(result.rows[0]) : null;
}

export async function getGuardianOneShotCampaignsWithDatabase(
  database: Pick<GuardianCampaignDatabase, "query">,
): Promise<GuardianCampaignSnapshot[]> {
  const keys = Object.values(guardianScenarios).flatMap((scenario) => scenario.campaignKey ? [scenario.campaignKey] : []);
  const result = await database.query(
    `SELECT id, campaign_key, campaign_type, text, action_label, action_url, audience_rule, created_at,
            recipient_count, telegram_delivery_count, created_by_participant_id
       FROM guardian_campaigns WHERE campaign_key = ANY($1::text[])`, [keys],
  );
  return result.rows.map(snapshot);
}

export async function getGuardianCampaignByIdWithDatabase(database: Pick<GuardianCampaignDatabase, "query">, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) return null;
  const result = await database.query(
    `SELECT id, campaign_key, campaign_type, text, action_label, action_url, audience_rule, created_at,
            recipient_count, telegram_delivery_count, created_by_participant_id
       FROM guardian_campaigns WHERE id = $1::uuid`, [id],
  );
  return result.rowCount ? snapshot(result.rows[0]) : null;
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

export type GuardianCampaignLaunch = { scenario: GuardianScenarioType; text: string; residenceKey?: string };

export async function launchGuardianCampaignWithDatabase(
  database: Pick<GuardianCampaignDatabase, "connect">,
  adminId: string,
  input: GuardianCampaignLaunch,
): Promise<{ campaign: GuardianCampaignSnapshot; launched: boolean }> {
  const scenario = guardianScenario(input.scenario);
  const draft = parseGuardianCampaignDraft({ text: input.text });
  const campaignKey = scenario.campaignKey ?? `${scenario.type}:${randomUUID()}`;
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    if (scenario.repeatPolicy === "once_per_version") {
      await client.query("SELECT pg_advisory_xact_lock(42008, hashtext($1::text))", [campaignKey]);
      const existing = await campaignWithDatabase(client, campaignKey);
      if (existing) {
        await client.query("COMMIT");
        return { campaign: existing, launched: false };
      }
    }

    // Resolve current Core membership and profile state again inside the launch transaction.
    const overview = await getGuardianAudienceWithDatabase(client);
    const recipients = resolveGuardianScenarioAudience(scenario.type, overview, { residenceKey: input.residenceKey });
    const recipientIds = recipients.map((person) => person.id);
    if (!recipientIds.length) throw new GuardianCampaignValidationError("Campaign audience is empty");
    const telegramIds = await telegramRecipients(client, recipientIds);
    const reward = await getGuardianCampaignRewardWithDatabase(client, scenario.type);
    const { text } = parseGuardianCampaignDraft({
      text: reward ? `${draft.text}\n\n${reward.sentence}` : draft.text,
    });
    const residence = scenario.type === "town_meeting"
      ? guardianResidenceOptions(overview).find((option) => option.key === input.residenceKey) : undefined;
    const audienceRule = {
      current: "forum_joined_or_logged_in", excludeMembershipStatuses: ["left", "excluded"],
      excludeRosterBots: true, selection: scenario.audienceRule,
      ...(residence ? { residence: { key: residence.key, label: residence.label } } : {}),
    };
    const inserted = await client.query(
      `INSERT INTO guardian_campaigns(campaign_key, campaign_type, text, action_label,
           action_url, audience_rule, created_by_participant_id, recipient_count, telegram_delivery_count)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::uuid, $8, $9)
       ON CONFLICT (campaign_key) DO NOTHING
       RETURNING id, campaign_key, campaign_type, text, action_label, action_url, audience_rule, created_at, recipient_count,
                 telegram_delivery_count, created_by_participant_id`,
      [campaignKey, scenario.type,
        text, scenario.actionLabel, scenario.actionUrl, JSON.stringify(audienceRule),
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
      [campaign.id, recipientIds, scenario.notificationType, text,
        scenario.actionLabel, scenario.actionUrl, adminId],
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

export async function getGuardianOneShotCampaigns() {
  const { pool } = await import("./db");
  return getGuardianOneShotCampaignsWithDatabase(pool);
}

export function technicalBroadcastCounts(campaign: GuardianCampaignSnapshot) {
  const channels = campaign.audienceRule.channels as { core: boolean; telegram: boolean };
  return { recipients: campaign.recipientCount, coreInbox: channels.core ? campaign.recipientCount : 0,
    telegramQueued: campaign.telegramDeliveryCount, telegramUnavailable: channels.telegram ? campaign.recipientCount - campaign.telegramDeliveryCount : 0 };
}

export async function launchTechnicalBroadcastWithDatabase(database: Pick<GuardianCampaignDatabase, "connect">, adminId: string, input: TechnicalBroadcastDraft) {
  const draft = parseTechnicalBroadcastDraft(input);
  const campaignKey = `technical_broadcast:${adminId}:${draft.submissionId}`;
  const filters = { city: draft.city, interests: draft.interests };
  const channels = { core: draft.core, telegram: draft.telegram };
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(42008, hashtext($1::text))", [campaignKey]);
    const existing = await campaignWithDatabase(client, campaignKey);
    if (existing) {
      const savedFilters = existing.audienceRule.filters as typeof filters | undefined;
      const savedChannels = existing.audienceRule.channels as typeof channels | undefined;
      if (existing.campaignType !== "technical_broadcast" || existing.createdByParticipantId !== adminId || existing.text !== draft.text ||
          savedFilters?.city !== filters.city || JSON.stringify(savedFilters?.interests) !== JSON.stringify(filters.interests) ||
          savedChannels?.core !== channels.core || savedChannels?.telegram !== channels.telegram) {
        throw new GuardianCampaignValidationError("Ключ отправки уже использован для другого сообщения или аудитории.");
      }
      await client.query("COMMIT");
      return { campaign: existing, launched: false, counts: technicalBroadcastCounts(existing) };
    }
    const overview = await getGuardianAudienceWithDatabase(client, filters);
    const recipientIds = [...new Set(overview.audience.map(p => p.id))];
    if (!recipientIds.length) throw new GuardianCampaignValidationError("Аудитория сообщения пуста.");
    const telegramIds = draft.telegram ? await telegramRecipients(client, recipientIds) : [];
    const rule = { current: "forum_joined_or_logged_in", excludeMembershipStatuses: ["left", "excluded"], excludeRosterBots: true,
      selection: "technical_broadcast", filters, channels };
    const inserted = await client.query(
      `INSERT INTO guardian_campaigns(campaign_key, campaign_type, text, action_label,
          action_url, audience_rule, created_by_participant_id, recipient_count, telegram_delivery_count)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::uuid, $8, $9)
       RETURNING id, campaign_key, campaign_type, text, action_label, action_url, audience_rule, created_at,
                 recipient_count, telegram_delivery_count, created_by_participant_id`,
      [campaignKey, "technical_broadcast", draft.text, null, null, JSON.stringify(rule), adminId, recipientIds.length, telegramIds.length]);
    const campaign = snapshot(inserted.rows[0]);
    const notifications = await client.query(
      `INSERT INTO notifications(campaign_id, participant_id, notification_type, text,
          action_label, action_url, source_type, created_by_participant_id, visible_in_inbox)
       SELECT $1::uuid, recipient.recipient_id, 'guardian.technical_broadcast', $3, NULL, NULL, 'admin', $4::uuid, $5
         FROM unnest($2::uuid[]) AS recipient(recipient_id) RETURNING id`,
      [campaign.id, recipientIds, draft.text, adminId, draft.core]);
    if (notifications.rowCount !== recipientIds.length) throw new Error("Broadcast notification count mismatch");
    if (telegramIds.length) {
      const deliveries = await client.query(
        `INSERT INTO notification_deliveries(notification_id, channel, status)
         SELECT notification.id, 'telegram', 'pending' FROM notifications notification
          WHERE notification.campaign_id = $1::uuid AND notification.participant_id = ANY($2::uuid[]) RETURNING id`, [campaign.id, telegramIds]);
      if (deliveries.rowCount !== telegramIds.length) throw new Error("Broadcast delivery count mismatch");
    }
    await client.query("COMMIT");
    return { campaign, launched: true, counts: technicalBroadcastCounts(campaign) };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function launchTechnicalBroadcast(adminId: string, input: TechnicalBroadcastDraft) {
  const { pool } = await import("./db");
  return launchTechnicalBroadcastWithDatabase(pool, adminId, input);
}

export async function getGuardianCampaignById(id: string) {
  const { pool } = await import("./db");
  return getGuardianCampaignByIdWithDatabase(pool, id);
}

export async function launchGuardianCampaign(adminId: string, input: GuardianCampaignLaunch) {
  const { pool } = await import("./db");
  return launchGuardianCampaignWithDatabase(pool, adminId, input);
}
