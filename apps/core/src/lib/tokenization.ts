type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type TokenizationClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};
export type TokenizationDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<TokenizationClient>;
};

export type RewardRule = {
  id: string;
  actionType: "verification_created";
  version: number;
  amount: string;
  active: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  changedBy: string;
};

export type DarusEntry = {
  id: string;
  amount: string;
  currency: "DARUS";
  sourceType: "verification_created" | "residence_first_filled";
  subjectName: string | null;
  createdAt: Date;
  rewardRuleVersion: number;
  tariff: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function formatDarusAmount(amount: string): string {
  return amount.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1").replace(".", ",");
}

export async function getVerificationRewardForFeedbackWithDatabase(
  database: Pick<TokenizationDatabase, "query">,
  entryId: string,
  verifierId: string,
  subjectId: string,
): Promise<string | null> {
  if (![entryId, verifierId, subjectId].every((id) => UUID_PATTERN.test(id))) return null;
  const result = await database.query(
    `SELECT ledger.amount
       FROM darus_ledger ledger
       JOIN verification_attestations attestation
         ON attestation.id = ledger.source_attestation_id
      WHERE ledger.id = $1::uuid
        AND ledger.participant_id = $2::uuid
        AND ledger.source_subject_id = $3::uuid
        AND ledger.source_type = 'verification_created'
        AND attestation.verifier_subject_id = $2::uuid
        AND attestation.subject_id = $3::uuid`,
    [entryId, verifierId, subjectId],
  );
  return result.rowCount ? String(result.rows[0].amount) : null;
}

export async function getVerificationRewardForFeedback(
  entryId: string,
  verifierId: string,
  subjectId: string,
): Promise<string | null> {
  const { pool } = await import("./db");
  return getVerificationRewardForFeedbackWithDatabase(pool, entryId, verifierId, subjectId);
}

export class RewardRuleValidationError extends Error {
  constructor() {
    super("Invalid DARUS reward rule");
    this.name = "RewardRuleValidationError";
  }
}

export function parseDarusAmount(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/.test(value) || !/[1-9]/.test(value)) {
    throw new RewardRuleValidationError();
  }
  return value;
}

function ruleFromRow(row: Record<string, unknown>): RewardRule {
  return {
    id: String(row.id),
    actionType: "verification_created",
    version: Number(row.version),
    amount: String(row.amount),
    active: Boolean(row.active),
    effectiveFrom: new Date(String(row.effective_from)),
    effectiveTo: row.effective_to ? new Date(String(row.effective_to)) : null,
    changedBy: String(row.changed_by),
  };
}

export async function getCurrentRewardRuleWithDatabase(
  database: Pick<TokenizationDatabase, "query">,
): Promise<RewardRule> {
  const result = await database.query(
    `SELECT id, action_type, version, amount, active, effective_from, effective_to, changed_by
       FROM reward_rules
      WHERE action_type = 'verification_created' AND effective_from <= now()
      ORDER BY version DESC LIMIT 1`,
  );
  if (!result.rowCount) throw new Error("Verification reward rule is missing");
  return ruleFromRow(result.rows[0]);
}

export async function getCurrentRewardRule(): Promise<RewardRule> {
  const { pool } = await import("./db");
  return getCurrentRewardRuleWithDatabase(pool);
}

export async function saveRewardRuleWithDatabase(
  database: Pick<TokenizationDatabase, "connect">,
  actorId: string,
  amount: string,
  active: boolean,
): Promise<boolean> {
  parseDarusAmount(amount);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE reward_rules IN SHARE ROW EXCLUSIVE MODE");
    const current = await client.query(
      `SELECT version, amount, active FROM reward_rules
        WHERE action_type = 'verification_created'
        ORDER BY version DESC LIMIT 1`,
    );
    if (!current.rowCount) throw new Error("Verification reward rule is missing");
    const previous = current.rows[0];
    if (String(previous.amount) === normalizeAmount(amount) && Boolean(previous.active) === active) {
      await client.query("COMMIT");
      return false;
    }
    await client.query(
      `INSERT INTO reward_rules(action_type, version, amount, active, changed_by, effective_from)
       VALUES ('verification_created', $1, $2::numeric, $3, $4, clock_timestamp())`,
      [Number(previous.version) + 1, amount, active, actorId],
    );
    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ('reward_rule.version_created', $1, $2::jsonb)`,
      [actorId, JSON.stringify({ action_type: "verification_created", version: Number(previous.version) + 1, amount, active })],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve original error. */ }
    throw error;
  } finally {
    client.release();
  }
}

function normalizeAmount(value: string): string {
  const [whole, fractional = ""] = value.split(".");
  return `${whole}.${fractional.padEnd(6, "0")}`;
}

export async function saveRewardRule(actorId: string, amount: string, active: boolean) {
  const { pool } = await import("./db");
  return saveRewardRuleWithDatabase(pool, actorId, amount, active);
}

export async function getDarusBalanceWithDatabase(
  database: Pick<TokenizationDatabase, "query">,
  participantId: string,
): Promise<string> {
  const result = await database.query(
    `SELECT COALESCE(SUM(amount), 0) AS balance
       FROM darus_ledger WHERE participant_id = $1::uuid`,
    [participantId],
  );
  return String(result.rows[0].balance);
}

export async function getDarusBalance(participantId: string): Promise<string> {
  const { pool } = await import("./db");
  return getDarusBalanceWithDatabase(pool, participantId);
}

export async function getDarusHistoryWithDatabase(
  database: Pick<TokenizationDatabase, "query">,
  participantId: string,
): Promise<DarusEntry[]> {
  const result = await database.query(
    `SELECT ledger.id, ledger.amount, ledger.currency, ledger.source_type,
            ledger.created_at, ledger.reward_rule_version,
            subject.display_name AS subject_name, rules.amount AS tariff
       FROM darus_ledger ledger
       LEFT JOIN participants subject ON subject.id = ledger.source_subject_id
       JOIN reward_rules rules ON rules.id = ledger.reward_rule_id
      WHERE ledger.participant_id = $1::uuid
      ORDER BY ledger.created_at DESC, ledger.id DESC`,
    [participantId],
  );
  return result.rows.map((row) => ({
    id: String(row.id), amount: String(row.amount), currency: "DARUS",
    sourceType: String(row.source_type) as DarusEntry["sourceType"],
    subjectName: row.subject_name ? String(row.subject_name) : null,
    createdAt: new Date(String(row.created_at)),
    rewardRuleVersion: Number(row.reward_rule_version), tariff: String(row.tariff),
  }));
}

export async function getDarusHistory(participantId: string): Promise<DarusEntry[]> {
  const { pool } = await import("./db");
  return getDarusHistoryWithDatabase(pool, participantId);
}
