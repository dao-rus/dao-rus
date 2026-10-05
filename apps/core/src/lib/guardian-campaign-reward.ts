import { guardianScenarios, type GuardianScenarioType } from "./guardian-campaign-scenarios";
import { formatDarusAmount, type TokenizationDatabase } from "./tokenization";

export type GuardianCampaignReward = { note: string; sentence: string };

/** The latest effective version may disable an older active rule. */
export async function getGuardianCampaignRewardWithDatabase(
  database: Pick<TokenizationDatabase, "query">,
  type: GuardianScenarioType,
): Promise<GuardianCampaignReward | null> {
  const action = guardianScenarios[type].rewardAction;
  if (!action) return null;
  const result = await database.query(
    `SELECT amount, active FROM reward_rules
      WHERE action_type = $1 AND effective_from <= clock_timestamp()
        AND (effective_to IS NULL OR effective_to > clock_timestamp())
      ORDER BY version DESC LIMIT 1`, [action],
  );
  const rule = result.rows[0];
  if (!rule || rule.active !== true) return null;
  const amount = formatDarusAmount(String(rule.amount));
  return action === "residence_first_filled"
    ? { note: `Награда: +${amount} DARUS за первое заполнение`,
        sentence: `Если вы указываете город впервые, вы получите +${amount} DARUS.` }
    : { note: `Награда: +${amount} DARUS за первое добавление интереса`,
        sentence: `Если вы добавляете интерес впервые, вы получите +${amount} DARUS.` };
}

export async function getGuardianCampaignReward(type: GuardianScenarioType) {
  const { pool } = await import("./db");
  return getGuardianCampaignRewardWithDatabase(pool, type);
}
