import { formatDarusAmount, type TokenizationClient } from "./tokenization";

export const onboardingQuestDefinitions = [
  { sourceType: "residence_first_filled", textKey: "onboarding.residence", href: "/profile#residence-name" },
  { sourceType: "interest_first_added", textKey: "onboarding.interest", href: "/profile#profile-interests" },
  { sourceType: "need_first_created", textKey: "onboarding.need", href: "/need" },
  { sourceType: "have_first_created", textKey: "onboarding.have", href: "/profile#signal-have" },
] as const;
export type OnboardingSourceType = typeof onboardingQuestDefinitions[number]["sourceType"];
export type OnboardingReward = { id: string; amount: string };
type Database = Pick<TokenizationClient, "query">;

/** Completion facts are permanent; editable profile fields are never quest state. */
export async function getOnboardingQuestsWithDatabase(database: Database, participantId: string | null) {
  if (!participantId) return [];
  const result = await database.query(
    `SELECT rule.action_type, rule.amount, rule.active,
            EXISTS (SELECT 1 FROM onboarding_quest_completions completion
                     WHERE completion.participant_id = $1::uuid AND completion.source_type = rule.action_type) AS completed
       FROM (SELECT DISTINCT ON (action_type) action_type, amount, active
               FROM reward_rules WHERE action_type = ANY($2::text[]) AND effective_from <= clock_timestamp()
                 AND (effective_to IS NULL OR effective_to > clock_timestamp())
              ORDER BY action_type, version DESC) rule`,
    [participantId, onboardingQuestDefinitions.map(quest => quest.sourceType)],
  );
  return onboardingQuestDefinitions.flatMap(quest => {
    const rule = result.rows.find(row => row.action_type === quest.sourceType);
    return rule && rule.active && !rule.completed ? [{ ...quest, amount: String(rule.amount) }] : [];
  });
}

export async function getOnboardingQuests(participantId: string | null) {
  if (!participantId) return [];
  const { pool } = await import("./db");
  return getOnboardingQuestsWithDatabase(pool, participantId);
}

/** Read only the reward actually inserted by this action's open transaction. */
export async function getOnboardingActionReward(database: Database, participantId: string, source: OnboardingSourceType): Promise<OnboardingReward | undefined> {
  const result = await database.query(
    `SELECT ledger.id, ledger.amount FROM events event JOIN darus_ledger ledger ON ledger.id::text = event.payload->>'ledger_id'
      WHERE event.event_type = 'onboarding.quest_completed' AND event.participant_id = $1::uuid
        AND event.payload->>'source_type' = $2 AND event.payload->>'transaction_id' = txid_current()::text
        AND ledger.participant_id = $1::uuid AND ledger.source_type = $2`,
    [participantId, source],
  );
  return result.rows[0] ? { id: String(result.rows[0].id), amount: String(result.rows[0].amount) } : undefined;
}

export async function getOnboardingRewardFeedbackWithDatabase(database: Database, participantId: string, entryId?: string): Promise<string | null> {
  if (!entryId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entryId)) return null;
  const result = await database.query(
    `SELECT amount FROM darus_ledger WHERE id = $1::uuid AND participant_id = $2::uuid AND source_type = ANY($3::text[])`,
    [entryId, participantId, onboardingQuestDefinitions.map(quest => quest.sourceType)],
  );
  return result.rows[0] ? `+${formatDarusAmount(String(result.rows[0].amount))} DARUS начислено` : null;
}
export async function getOnboardingRewardFeedback(participantId: string, entryId?: string) {
  if (!entryId) return null;
  const { pool } = await import("./db");
  return getOnboardingRewardFeedbackWithDatabase(pool, participantId, entryId);
}
