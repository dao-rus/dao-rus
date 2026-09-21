import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  getDarusBalanceWithDatabase,
  getDarusHistoryWithDatabase,
  parseDarusAmount,
  saveRewardRuleWithDatabase,
  RewardRuleValidationError,
  type TokenizationClient,
} from "./tokenization";

class FakeClient implements TokenizationClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;
  constructor(private previous = { version: 1, amount: "0.100000", active: true }) {}
  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });
    if (text.includes("SELECT version, amount, active FROM reward_rules")) {
      return { rowCount: 1, rows: [this.previous] };
    }
    return { rowCount: 1, rows: [] };
  }
  release() { this.released = true; }
}

const actorId = "10000000-0000-4000-8000-000000000001";

describe("DARUS tokenization", () => {
  it("requires positive decimal amounts of at most six fractional places", () => {
    expect(parseDarusAmount("0.1")).toBe("0.1");
    expect(parseDarusAmount("1.000001")).toBe("1.000001");
    for (const invalid of ["0", "0.000000", "-1", "1e3", "1.1234567", "NaN", "100000000000000", null]) {
      expect(() => parseDarusAmount(invalid)).toThrow(RewardRuleValidationError);
    }
  });

  it("creates a new version and event in one transaction", async () => {
    const client = new FakeClient();
    const changed = await saveRewardRuleWithDatabase({ connect: async () => client }, actorId, "0.2", false);
    expect(changed).toBe(true);
    expect(client.queries.map((query) => query.text)).toContain("LOCK TABLE reward_rules IN SHARE ROW EXCLUSIVE MODE");
    expect(client.queries.find((query) => query.text.includes("INSERT INTO reward_rules"))?.values)
      .toEqual([2, "0.2", false, actorId]);
    expect(client.queries.some((query) => query.text.includes("UPDATE reward_rules"))).toBe(false);
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
    expect(client.released).toBe(true);
  });

  it("does not add a version when amount and state are unchanged", async () => {
    const client = new FakeClient();
    expect(await saveRewardRuleWithDatabase({ connect: async () => client }, actorId, "0.1", true)).toBe(false);
    expect(client.queries.some((query) => query.text.includes("INSERT INTO reward_rules"))).toBe(false);
  });

  it("sums numeric ledger entries and reads applied tariff without float conversion", async () => {
    const queries: string[] = [];
    const database = { async query(text: string) {
      queries.push(text);
      return text.includes("SUM(amount)")
        ? { rowCount: 1, rows: [{ balance: "0.300000" }] }
        : { rowCount: 1, rows: [{ id: "entry", amount: "0.100000", currency: "DARUS", source_type: "verification_created", created_at: "2026-09-21T00:00:00Z", reward_rule_version: 1, subject_name: "Анна", tariff: "0.100000" }] };
    } };
    expect(await getDarusBalanceWithDatabase(database, actorId)).toBe("0.300000");
    expect((await getDarusHistoryWithDatabase(database, actorId))[0]).toMatchObject({
      amount: "0.100000", tariff: "0.100000", rewardRuleVersion: 1, subjectName: "Анна",
    });
    expect(queries[0]).toContain("SUM(amount)");
    expect(queries[1]).toContain("ledger.participant_id = $1::uuid");
  });

  it("defines immutable numeric ledger and database pair idempotency", async () => {
    const migration = await readFile(new URL("../../migrations/016_tokenization.sql", import.meta.url), "utf8");
    expect(migration).toContain("amount numeric(20, 6)");
    expect(migration).toContain("CREATE UNIQUE INDEX darus_ledger_verification_pair_idx");
    expect(migration).toContain("ON darus_ledger(participant_id, source_subject_id)");
    expect(migration).toContain("darus_ledger_no_update_or_delete");
    expect(migration).toContain("reward_rules_no_update_or_delete");
  });
});
