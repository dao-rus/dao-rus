import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getOnboardingQuestsWithDatabase, getOnboardingRewardFeedbackWithDatabase } from "./onboarding-quests";
import { addProfileInterestWithDatabase, addProfileSignalWithDatabase, archiveProfileSignalWithDatabase,
  removeProfileInterestWithDatabase, saveProfileWithDatabase } from "./profile-about";

const databaseUrl = process.env.ONBOARDING_TEST_DATABASE_URL;
const schema = `onboarding_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
const old = randomUUID(), transitional = randomUUID(), satisfied = randomUUID();
async function participant() {
  const id = randomUUID();
  await pool.query("INSERT INTO participants(id, display_name) VALUES ($1, 'Test participant')", [id]);
  return id;
}
async function countRewards(id: string) {
  return Number((await pool.query("SELECT count(*) FROM darus_ledger WHERE participant_id=$1", [id])).rows[0].count);
}

describe.skipIf(!databaseUrl)("onboarding quests on real PostgreSQL", () => {
  beforeAll(async () => {
    // This test must never accept the application's production DATABASE_URL.
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/onboarding_tests") throw new Error("Use the isolated local onboarding_tests database");
    await pool.query(`CREATE SCHEMA ${schema}`);
    const directory = new URL("../../migrations/", import.meta.url);
    for (const name of readdirSync(directory).filter(name => name.endsWith(".sql") && name < "026_").sort()) {
      await pool.query("BEGIN;" + readFileSync(new URL(name, directory), "utf8") + ";COMMIT;");
    }
    await pool.query("INSERT INTO participants(id, display_name) SELECT unnest($1::uuid[]), 'Historical test'", [[old, transitional, satisfied]]);
    await pool.query(`INSERT INTO events(event_type, participant_id, payload, created_at) VALUES
      ('participant.about_updated', $1, '{"field":"residence"}', '2026-10-01'),
      ('participant.interest_saved', $1, '{}', '2026-10-01'),
      ('participant.interest_saved', $1, '{}', '2026-10-02T10:45:00Z'),
      ('participant.signal_created', $1, '{"kind":"need"}', '2026-10-01'),
      ('participant.signal_created', $1, '{"kind":"have"}', '2026-10-01'),
      ('participant.interest_saved', $2, '{}', '2026-10-02T10:45:00Z'),
      ('participant.signal_created', $2, '{"kind":"need"}', '2026-10-02T10:46:00Z'),
      ('participant.interest_saved', $3, '{}', '2026-10-02T10:45:00Z')`, [old, transitional, satisfied]);
    await pool.query(`INSERT INTO darus_ledger(participant_id, amount, reward_rule_id, reward_rule_version, source_type, created_at)
      SELECT $1, amount, id, version, 'residence_first_filled', '2026-10-02T10:44:00Z' FROM reward_rules
       WHERE action_type='residence_first_filled' AND version=1`, [satisfied]);
    await pool.query("BEGIN;" + readFileSync(new URL("026_onboarding_quests.sql", directory), "utf8") + ";COMMIT;");
  }, 30000);
  afterAll(async () => { await pool.query("ROLLBACK"); await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); });

  it("shows four quests to a new participant, and nothing to a guest", async () => {
    expect(await getOnboardingQuestsWithDatabase(pool, await participant())).toHaveLength(4);
    expect(await getOnboardingQuestsWithDatabase(pool, null)).toEqual([]);
  });
  it("completes all first actions with exact awards, audit and immediate feedback", async () => {
    const id = await participant();
    const city = await saveProfileWithDatabase(pool, id, "Test", "", "members", {name:"Test city",type:"город",country:"Test country"});
    expect(city.reward?.amount).toBe("0.100000");
    const interest = await addProfileInterestWithDatabase(pool, id, "Test interest", "members");
    const need = await addProfileSignalWithDatabase(pool, id, "need", "Test need", "private");
    const have = await addProfileSignalWithDatabase(pool, id, "have", "Test have", "members");
    expect(interest?.amount).toBe("0.100000"); expect(need?.amount).toBe("0.200000"); expect(have?.amount).toBe("0.200000");
    expect(await getOnboardingQuestsWithDatabase(pool, id)).toEqual([]);
    expect(await getOnboardingRewardFeedbackWithDatabase(pool, id, interest?.id)).toBe("+0,1 DARUS начислено");
    expect(await getOnboardingRewardFeedbackWithDatabase(pool, id, need?.id)).toBe("+0,2 DARUS начислено");
    expect(await getOnboardingRewardFeedbackWithDatabase(pool, await participant(), need?.id)).toBeNull();
    const audit = await pool.query("SELECT payload FROM events WHERE participant_id=$1 AND event_type='onboarding.quest_completed'", [id]);
    expect(audit.rows).toHaveLength(4);
    expect(audit.rows.every(row => row.payload.completion_id && row.payload.ledger_id && row.payload.transaction_id)).toBe(true);
    expect((await pool.query("SELECT sum(amount)::text AS amount FROM darus_ledger WHERE participant_id=$1", [id])).rows[0].amount).toBe("0.600000");
  });
  it("never restores or rewards quests after delete, clear, archive or repeat", async () => {
    const id = await participant();
    await saveProfileWithDatabase(pool, id, "Test", "", "members", {name:"City",type:"город",country:"Country"});
    await saveProfileWithDatabase(pool, id, "Test", "", "members", {name:"",type:"",country:""});
    expect((await saveProfileWithDatabase(pool, id, "Test", "", "members", {name:"City",type:"город",country:"Country"})).reward).toBeUndefined();
    await addProfileInterestWithDatabase(pool, id, "Interest", "members");
    const interestId = (await pool.query("SELECT id FROM participant_interests WHERE participant_id=$1", [id])).rows[0].id;
    await removeProfileInterestWithDatabase(pool, id, interestId);
    expect(await addProfileInterestWithDatabase(pool, id, "Interest", "members")).toBeUndefined();
    for (const kind of ["need", "have"] as const) {
      await addProfileSignalWithDatabase(pool, id, kind, "Test", "members");
      const signalId = (await pool.query("SELECT id FROM profile_signals WHERE participant_id=$1 AND kind=$2", [id,kind])).rows[0].id;
      await archiveProfileSignalWithDatabase(pool, id, signalId);
      expect(await addProfileSignalWithDatabase(pool, id, kind, "Again", "members")).toBeUndefined();
    }
    expect(await countRewards(id)).toBe(4);
    expect(await getOnboardingQuestsWithDatabase(pool, id)).toEqual([]);
  });
  it("backfills deleted historical actions without retroactive rewards", async () => {
    expect(await getOnboardingQuestsWithDatabase(pool, old)).toEqual([]);
    await addProfileInterestWithDatabase(pool, old, "Recreated", "members");
    await addProfileSignalWithDatabase(pool, old, "need", "Recreated", "members");
    await saveProfileWithDatabase(pool, old, "Historical", "", "members", {name:"City",type:"город",country:"Country"});
    expect(await countRewards(old)).toBe(0);
  });
  it("reconciles the transition once per person and excludes already paid residence", async () => {
    expect(await countRewards(transitional)).toBe(1);
    expect((await pool.query("SELECT source_type,amount FROM darus_ledger WHERE participant_id=$1", [transitional])).rows[0])
      .toEqual({source_type:"onboarding_promise_reconciled",amount:"0.100000"});
    expect(await countRewards(satisfied)).toBe(1);
    await addProfileInterestWithDatabase(pool, transitional, "Recreated", "members");
    expect(await countRewards(transitional)).toBe(1);
  });
  it("concurrent requests for distinct interests and signals cannot double award", async () => {
    const id = await participant();
    const interests = await Promise.all(Array.from({length:8},(_,index)=>addProfileInterestWithDatabase(pool,id,`Interest ${index}`,"members")));
    expect(interests.filter(Boolean)).toHaveLength(1);
    for (const kind of ["need", "have"] as const) {
      const rewards = await Promise.all(Array.from({length:8},()=>addProfileSignalWithDatabase(pool,id,kind,"Concurrent","members")));
      expect(rewards.filter(Boolean)).toHaveLength(1);
    }
    const cities = await Promise.all(Array.from({length:8},()=>saveProfileWithDatabase(pool,id,"Test","","members",{name:"City",type:"город",country:"Country"})));
    expect(cities.filter(result=>result.reward)).toHaveLength(1);
    expect(await countRewards(id)).toBe(4);
  });
  it("rolls back action, completion and ledger together if the action event fails", async () => {
    const id = await participant();
    await pool.query(`CREATE FUNCTION fail_action_event() RETURNS trigger AS $$ BEGIN
      IF NEW.event_type = 'participant.signal_created' AND NEW.participant_id = '${id}'::uuid THEN RAISE EXCEPTION 'test audit failure'; END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_action_event BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION fail_action_event();`);
    await expect(addProfileSignalWithDatabase(pool,id,"need","Rollback","members")).rejects.toThrow("test audit failure");
    expect(await countRewards(id)).toBe(0);
    expect(await getOnboardingQuestsWithDatabase(pool,id)).toHaveLength(4);
    expect((await pool.query("SELECT count(*) FROM profile_signals WHERE participant_id=$1",[id])).rows[0].count).toBe("0");
    await pool.query("DROP TRIGGER fail_action_event ON events; DROP FUNCTION fail_action_event()");
  });
  it("enforces uniqueness even for SQL writers bypassing the application", async () => {
    const id = await participant();
    await addProfileInterestWithDatabase(pool,id,"First","members");
    await expect(pool.query(`INSERT INTO darus_ledger(participant_id,amount,reward_rule_id,reward_rule_version,source_type)
      SELECT participant_id,amount,reward_rule_id,reward_rule_version,source_type FROM darus_ledger WHERE participant_id=$1`,[id]))
      .rejects.toMatchObject({code:"23505"});
    await expect(pool.query("DELETE FROM onboarding_quest_completions WHERE participant_id=$1",[id])).rejects.toThrow("append-only");
    expect(await countRewards(id)).toBe(1);
    expect(await getOnboardingRewardFeedbackWithDatabase(pool,id,"------------------------------------")).toBeNull();
  });
});
