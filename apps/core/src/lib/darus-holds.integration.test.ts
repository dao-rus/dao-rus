import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDarusBalanceWithDatabase } from "./tokenization";
import { DarusMovementConflict, distributeHeldDarusWithDatabase, getDarusBookWithDatabase, holdDarusWithDatabase, refundHeldDarusWithDatabase } from "./darus-holds";

const databaseUrl = process.env.DARUS_TEST_DATABASE_URL;
const schema = `darus_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
let schemaCreated = false;
let legacy: string;
async function participant(fund = true) {
  const id = randomUUID();
  await pool.query("INSERT INTO participants(id,display_name) VALUES($1,'Synthetic DARUS test')", [id]);
  if (fund) await pool.query(`INSERT INTO darus_ledger(participant_id,amount,reward_rule_id,reward_rule_version,source_type)
    SELECT $1,amount,id,version,'interest_first_added' FROM reward_rules WHERE action_type='interest_first_added' AND version=1`, [id]);
  return id;
}
const source = () => ({ sourceType: "test.hold", sourceId: randomUUID() });
async function hold(owner: string, amount = "0.08") { return holdDarusWithDatabase(pool, { ...source(), participantId: owner, amount }); }
async function balance(owner: string) { return getDarusBalanceWithDatabase(pool, owner); }
async function remaining(id: string) { return String((await pool.query("SELECT -sum(amount) AS n FROM darus_movements WHERE hold_id=$1", [id])).rows[0].n); }

describe.skipIf(!databaseUrl)("DARUS holds on isolated PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/darus_tests") throw new Error("Use the isolated local darus_tests database");
    await pool.query(`CREATE SCHEMA ${schema}`); schemaCreated = true;
    const directory = new URL("../../migrations/", import.meta.url);
    for (const name of readdirSync(directory).filter(name => name.endsWith(".sql") && name < "045_").sort()) {
      await pool.query("BEGIN;" + readFileSync(new URL(name, directory), "utf8") + ";COMMIT;");
    }
    legacy = await participant();
    const before = (await pool.query("SELECT row_to_json(d) AS row FROM darus_ledger d ORDER BY id")).rows;
    const amounts = (await pool.query("SELECT participant_id,sum(amount)::text AS amount FROM darus_ledger GROUP BY participant_id ORDER BY participant_id")).rows;
    await pool.query("BEGIN;" + readFileSync(new URL("045_darus_holds.sql", directory), "utf8") + ";COMMIT;");
    expect((await pool.query("SELECT row_to_json(d) AS row FROM darus_ledger d ORDER BY id")).rows).toEqual(before);
    expect((await pool.query("SELECT participant_id,sum(amount)::text AS amount FROM darus_book GROUP BY participant_id ORDER BY participant_id")).rows).toEqual(amounts);
  }, 30000);
  afterAll(async () => { if (schemaCreated) { await pool.query("ROLLBACK"); await pool.query(`DROP SCHEMA ${schema} CASCADE`); } await pool.end(); });

  it("preserves historical mint rows and displayed balances after migration", async () => {
    expect(await balance(legacy)).toBe("0.100000");
    expect((await getDarusBookWithDatabase(pool, legacy))[0].kind).toBe("mint");
    expect((await pool.query("SELECT count(*)::int AS n FROM darus_movements")).rows[0].n).toBe(0);
  });
  it("debits into an immutable object and reports one complete book", async () => {
    const owner = await participant(), id = await hold(owner);
    expect(await balance(owner)).toBe("0.020000"); expect(await remaining(id)).toBe("0.080000");
    expect((await getDarusBookWithDatabase(pool, owner)).map(row => row.kind).sort()).toEqual(["hold", "mint"]);
  });
  it("rejects spending more than the balance with no partial hold", async () => {
    const owner = await participant();
    await expect(hold(owner, "0.11")).rejects.toThrow("Insufficient DARUS balance");
    expect(await balance(owner)).toBe("0.100000");
    expect((await pool.query("SELECT count(*)::int AS n FROM darus_holds WHERE participant_id=$1", [owner])).rows[0].n).toBe(0);
  });
  it("serializes simultaneous distinct spends so a balance cannot go negative", async () => {
    const owner = await participant();
    const results = await Promise.allSettled([hold(owner), hold(owner)]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
    expect(await balance(owner)).toBe("0.020000");
  });
  it("makes concurrent exhausted-balance retries idempotent and rejects parameter changes", async () => {
    const input = { ...source(), participantId: await participant(), amount: "0.1" };
    const ids = await Promise.all(Array.from({ length: 8 }, (_, index) => holdDarusWithDatabase(pool, index % 2 ? { ...input, sourceId: input.sourceId.toUpperCase(), participantId: input.participantId.toUpperCase() } : input)));
    expect(new Set(ids).size).toBe(1); expect(await balance(input.participantId)).toBe("0.000000");
    expect((await pool.query("SELECT count(*)::int AS n FROM darus_movements WHERE hold_id=$1", [ids[0]])).rows[0].n).toBe(1);
    await expect(holdDarusWithDatabase(pool, { ...input, amount: "0.09" })).rejects.toBeInstanceOf(DarusMovementConflict);
  });
  it("distributes and refunds without minting and retries both after the hold is empty", async () => {
    const owner = await participant(), first = await participant(false), second = await participant(false), id = await hold(owner);
    const payout = source(), refund = source(), allocations = [{ participantId: first, amount: "0.03" }, { participantId: second, amount: "0.04" }];
    const ids = await distributeHeldDarusWithDatabase(pool, id, payout, allocations);
    const returned = await refundHeldDarusWithDatabase(pool, id, refund, owner, "0.01");
    expect(await distributeHeldDarusWithDatabase(pool, id.toUpperCase(), { ...payout, sourceId: payout.sourceId.toUpperCase() }, allocations)).toEqual(ids);
    expect(await refundHeldDarusWithDatabase(pool, id, refund, owner, "0.01")).toBe(returned);
    expect(await balance(owner)).toBe("0.030000"); expect(await balance(first)).toBe("0.030000"); expect(await balance(second)).toBe("0.040000");
    expect(await remaining(id)).toBe("0.000000");
    expect((await pool.query("SELECT count(*)::int AS n FROM darus_ledger WHERE participant_id=ANY($1::uuid[])", [[owner, first, second]])).rows[0].n).toBe(1);
    await expect(refundHeldDarusWithDatabase(pool, id, source(), owner, "0.01")).rejects.toThrow("Insufficient held DARUS");
  });
  it("rolls back the whole payout batch when its sum exceeds the hold", async () => {
    const owner = await participant(), first = await participant(false), second = await participant(false), id = await hold(owner);
    await expect(distributeHeldDarusWithDatabase(pool, id, source(), [{ participantId: first, amount: "0.03" }, { participantId: second, amount: "0.06" }])).rejects.toThrow("Insufficient held DARUS");
    expect(await balance(first)).toBe("0"); expect(await balance(second)).toBe("0"); expect(await remaining(id)).toBe("0.080000");
  });
  it("serializes concurrent payouts and refuses a refund to someone else", async () => {
    const owner = await participant(), a = await participant(false), b = await participant(false), id = await hold(owner);
    const results = await Promise.allSettled([a, b].map(participantId => distributeHeldDarusWithDatabase(pool, id, source(), [{ participantId, amount: "0.06" }])));
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1); expect(await remaining(id)).toBe("0.020000");
    await expect(refundHeldDarusWithDatabase(pool, id, source(), a, "0.01")).rejects.toThrow("DARUS refund must return to the holder");
    await expect(distributeHeldDarusWithDatabase(pool, id, source(), [{ participantId: a, amount: "0.03" }])).rejects.toThrow("Insufficient held DARUS");
  });
  it("protects invariants against direct SQL and mutation of history", async () => {
    const owner = await participant(), id = await hold(owner);
    await expect(pool.query("INSERT INTO darus_holds(participant_id,amount,source_type,source_id) VALUES($1,0.03,'test.raw',$2)", [owner, randomUUID()])).rejects.toThrow("Insufficient DARUS balance");
    await expect(pool.query("UPDATE darus_holds SET amount=0.09 WHERE id=$1", [id])).rejects.toThrow("append-only");
    await expect(pool.query("DELETE FROM darus_movements WHERE hold_id=$1", [id])).rejects.toThrow("append-only");
    await expect(pool.query("TRUNCATE darus_movements")).rejects.toThrow("append-only");
    await expect(pool.query("INSERT INTO darus_movements(participant_id,hold_id,kind,amount,source_type,source_id) VALUES($1,$2,'distribution',0.09,'test.raw',$3)", [owner, id, randomUUID()])).rejects.toThrow("Insufficient held DARUS");
    expect(await remaining(id)).toBe("0.080000");
  });
  it("rejects reusing a payout key against another hold or changing its amount", async () => {
    const a = await participant(), b = await participant(), recipient = await participant(false), one = await hold(a), two = await hold(b), payout = source();
    await distributeHeldDarusWithDatabase(pool, one, payout, [{ participantId: recipient, amount: "0.01" }]);
    await expect(distributeHeldDarusWithDatabase(pool, two, payout, [{ participantId: recipient, amount: "0.01" }])).rejects.toBeInstanceOf(DarusMovementConflict);
    await expect(distributeHeldDarusWithDatabase(pool, one, payout, [{ participantId: recipient, amount: "0.02" }])).rejects.toBeInstanceOf(DarusMovementConflict);
  });
});
