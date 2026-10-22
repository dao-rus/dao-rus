import { randomUUID } from "node:crypto";
import { getGuardianCampaignRewardWithDatabase } from "./guardian-campaign-reward";
import { getGuardianAudienceWithDatabase } from "./guardian-audience";
import { normalizeAudienceCityKey } from "./participant-audience";
import { GuardianCampaignValidationError, parseGuardianCampaignDraft, parseTechnicalBroadcastDraft, parseGuardianMessageDraft, type GuardianMessageDraft, type TechnicalBroadcastDraft } from "./guardian-campaign-input";
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

export function technicalBroadcastCounts(campaign: GuardianCampaignSnapshot) {
  // Old campaign snapshots predate explicit channels: both channels were selected.
  const channels = (campaign.audienceRule.channels ?? { core: true, telegram: true }) as { core: boolean; telegram: boolean };
  return { recipients: campaign.recipientCount, coreInbox: channels.core ? campaign.recipientCount : 0,
    telegramQueued: campaign.telegramDeliveryCount, telegramUnavailable: channels.telegram ? campaign.recipientCount - campaign.telegramDeliveryCount : 0 };
}

function messageFilters(draft: GuardianMessageDraft, type?: GuardianScenarioType) {
  const required = type === "profile_residence_prompt" ? "without_residence" : type === "profile_interests_prompt" ? "without_interests" : type === "core_login_prompt" ? "never_logged_in" : null;
  const conditions = [...new Set([...draft.conditions, ...(required ? [required] : [])])].sort() as GuardianMessageDraft["conditions"];
  return { city: draft.city, interests: draft.interests, ...(conditions.length ? { conditions } : {}) };
}
async function resolveMessage(database: Pick<GuardianCampaignDatabase, "query">, draft: GuardianMessageDraft, type?: GuardianScenarioType) {
  const scenario = type ? guardianScenario(type) : null, filters = messageFilters(draft, type);
  const overview = await getGuardianAudienceWithDatabase(database, filters);
  const allowed = scenario ? new Set(resolveGuardianScenarioAudience(scenario.type, overview, { residenceKey: draft.city }).map(p => p.id)) : null;
  const recipientIds = [...new Set(overview.audience.filter(p => !allowed || allowed.has(p.id)).map(p => p.id))];
  const reward = scenario ? await getGuardianCampaignRewardWithDatabase(database, scenario.type) : null;
  const { text } = parseGuardianCampaignDraft({ text: reward ? draft.text + "\n\n" + reward.sentence : draft.text });
  const residence = scenario?.type === "town_meeting" ? guardianResidenceOptions(overview).find(p => p.key === normalizeAudienceCityKey(draft.city)) : null;
  const rule = { current: "forum_joined_or_logged_in", excludeMembershipStatuses: ["left", "excluded"], excludeRosterBots: true,
    selection: scenario?.audienceRule ?? "technical_broadcast", filters, channels: { core: draft.core, telegram: draft.telegram },
    ...(draft.template ? { template: draft.template } : {}),
    ...(residence ? { residence: { key: residence.key, label: residence.label } } : {}) };
  return { recipientIds, text, rule, reward, actionLabel: scenario?.actionLabel ?? null };
}
export async function previewGuardianMessageWithDatabase(database: Pick<GuardianCampaignDatabase, "query">, input: GuardianMessageDraft) {
  const draft = parseGuardianMessageDraft(input), message = await resolveMessage(database, draft, draft.preset ?? undefined);
  return { recipientCount: message.recipientIds.length, text: message.text, actionLabel: message.actionLabel,
    rewardNote: message.reward?.note ?? null, core: draft.core, telegram: draft.telegram };
}
export async function previewGuardianMessage(input: GuardianMessageDraft) {
  const { pool } = await import("./db"); return previewGuardianMessageWithDatabase(pool, input);
}

/** One transactional pipeline for the composer and backward-compatible launch adapters. */
async function dispatch(database: Pick<GuardianCampaignDatabase, "connect">, adminId: string,
  input: GuardianMessageDraft, legacyScenario?: GuardianScenarioType) {
  const draft = parseGuardianMessageDraft(input);
  const scenario = draft.preset ? guardianScenario(draft.preset) : legacyScenario ? guardianScenario(legacyScenario) : null;
  const filters = messageFilters(draft, scenario?.type);
  const channels = { core: draft.core, telegram: draft.telegram };
  const campaignType = scenario?.type ?? "technical_broadcast";
  const campaignKey = scenario?.campaignKey ?? (legacyScenario ? legacyScenario + ":" + draft.submissionId : "technical_broadcast:" + adminId + ":" + draft.submissionId);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(42008, hashtext($1::text))", [campaignKey]);
    const existing = await campaignWithDatabase(client, campaignKey);
    if (existing) {
      if (scenario?.repeatPolicy !== "once_per_version") {
        const saved = existing.audienceRule.filters as typeof filters | undefined;
        const savedChannels = existing.audienceRule.channels as typeof channels | undefined;
        if (existing.campaignType !== campaignType || existing.createdByParticipantId !== adminId || existing.text !== draft.text ||
            saved?.city !== filters.city || JSON.stringify(saved?.interests) !== JSON.stringify(filters.interests) ||
            JSON.stringify(saved?.conditions ?? []) !== JSON.stringify(filters.conditions ?? []) ||
            savedChannels?.core !== channels.core || savedChannels?.telegram !== channels.telegram ||
            (existing.audienceRule.template ?? null) !== draft.template) {
          throw new GuardianCampaignValidationError("Ключ отправки уже использован для другого сообщения или аудитории.");
        }
      }
      await client.query("COMMIT");
      return { campaign: existing, launched: false, counts: technicalBroadcastCounts(existing) };
    }
    const message = await resolveMessage(client, draft, scenario?.type);
    const { recipientIds, text, rule } = message;
    if (!recipientIds.length) throw new GuardianCampaignValidationError("Аудитория сообщения пуста.");
    const telegramIds = draft.telegram ? await telegramRecipients(client, recipientIds) : [];
    const inserted = await client.query(
      `INSERT INTO guardian_campaigns(campaign_key, campaign_type, text, action_label,
           action_url, audience_rule, created_by_participant_id, recipient_count, telegram_delivery_count)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::uuid, $8, $9)
       ON CONFLICT (campaign_key) DO NOTHING
       RETURNING id, campaign_key, campaign_type, text, action_label, action_url, audience_rule, created_at,
                 recipient_count, telegram_delivery_count, created_by_participant_id`,
      [campaignKey, campaignType, text, scenario?.actionLabel ?? null, scenario?.actionUrl ?? null,
        JSON.stringify(rule), adminId, recipientIds.length, telegramIds.length]);
    if (!inserted.rowCount) throw new Error("Campaign key changed during locked dispatch");
    const campaign = snapshot(inserted.rows[0]);
    const notifications = await client.query(
      `INSERT INTO notifications(campaign_id, participant_id, notification_type, text,
           action_label, action_url, source_type, created_by_participant_id, visible_in_inbox)
       SELECT $1::uuid, recipient.recipient_id, $3, $4, $5, $6, 'admin', $7::uuid, $8
         FROM unnest($2::uuid[]) AS recipient(recipient_id) RETURNING id`,
      [campaign.id, recipientIds, scenario?.notificationType ?? "guardian.technical_broadcast", text,
        scenario?.actionLabel ?? null, scenario?.actionUrl ?? null, adminId, draft.core]);
    if (notifications.rowCount !== recipientIds.length) throw new Error("Campaign notification count mismatch");
    if (telegramIds.length) {
      const deliveries = await client.query(
        `INSERT INTO notification_deliveries(notification_id, channel, status)
         SELECT notification.id, 'telegram', 'pending' FROM notifications notification
          WHERE notification.campaign_id = $1::uuid AND notification.participant_id = ANY($2::uuid[]) RETURNING id`,
        [campaign.id, telegramIds]);
      if (deliveries.rowCount !== telegramIds.length) throw new Error("Campaign delivery count mismatch");
    }
    await client.query("COMMIT");
    return { campaign, launched: true, counts: technicalBroadcastCounts(campaign) };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export function dispatchGuardianMessageWithDatabase(database: Pick<GuardianCampaignDatabase, "connect">, adminId: string, input: GuardianMessageDraft) {
  return dispatch(database, adminId, input);
}
export async function launchTechnicalBroadcastWithDatabase(database: Pick<GuardianCampaignDatabase, "connect">, adminId: string, input: TechnicalBroadcastDraft) {
  return dispatch(database, adminId, parseGuardianMessageDraft(parseTechnicalBroadcastDraft(input)));
}
export async function launchGuardianCampaignWithDatabase(database: Pick<GuardianCampaignDatabase, "connect">, adminId: string, input: GuardianCampaignLaunch) {
  const scenario = guardianScenario(input.scenario);
  return dispatch(database, adminId, parseGuardianMessageDraft({ text: input.text, city: input.residenceKey ?? "", interests: [],
    core: scenario.type !== "core_login_prompt", telegram: true, submissionId: randomUUID() }), scenario.type);
}
export async function dispatchGuardianMessage(adminId: string, input: GuardianMessageDraft) {
  const { pool } = await import("./db"); return dispatchGuardianMessageWithDatabase(pool, adminId, input);
}
export async function getGuardianOneShotCampaigns() {
  const { pool } = await import("./db"); return getGuardianOneShotCampaignsWithDatabase(pool);
}
export async function getGuardianCampaignById(id: string) {
  const { pool } = await import("./db"); return getGuardianCampaignByIdWithDatabase(pool, id);
}
export async function launchGuardianCampaign(adminId: string, input: GuardianCampaignLaunch) {
  const { pool } = await import("./db"); return launchGuardianCampaignWithDatabase(pool, adminId, input);
}
export async function launchTechnicalBroadcast(adminId: string, input: TechnicalBroadcastDraft) {
  const { pool } = await import("./db"); return launchTechnicalBroadcastWithDatabase(pool, adminId, input);
}
