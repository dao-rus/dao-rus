import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  getCommunicationSummaryWithDatabase,
  setCommunicationSignalWithDatabase,
} from "./communication-reputation";

// This suite requires a disposable PostgreSQL database with migrations applied.
const url = process.env.HUB_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("communication reputation: PostgreSQL integration", () => {
  let database: Pool;

  beforeAll(async () => {
    database = new Pool({ connectionString: url, max: 8 });
    const migration = await database.query(
      "SELECT 1 FROM schema_migrations WHERE name='074_communication_reputation.sql'",
    );
    if (!migration.rowCount) throw new Error("Migration 074 must be applied to HUB_TEST_DATABASE_URL");
  });

  afterAll(async () => {
    if (database) await database.end();
  });

  async function participants() {
    const actor = (await database.query(
      "INSERT INTO participants(display_name) VALUES ('Communication test actor') RETURNING id",
    )).rows[0].id as string;
    const subject = (await database.query(
      "INSERT INTO participants(display_name) VALUES ('Communication test subject') RETURNING id",
    )).rows[0].id as string;
    return { actor, subject };
  }

  it("keeps one active directed rating, makes repeats idempotent, and preserves change and revocation history", async () => {
    const { actor, subject } = await participants();

    expect(await setCommunicationSignalWithDatabase(database, actor, subject, "positive")).toBe("created");
    expect(await setCommunicationSignalWithDatabase(database, actor, subject, "positive")).toBe("unchanged");
    expect(await setCommunicationSignalWithDatabase(database, actor, subject, "negative")).toBe("changed");

    const changed = await database.query(`
      SELECT signal_type, revoked_at FROM reputation_signals
       WHERE actor_participant_id=$1 AND subject_participant_id=$2 AND dimension='communication'
       ORDER BY created_at,id
    `, [actor, subject]);
    expect(changed.rows).toHaveLength(2);
    expect(changed.rows[0].signal_type).toBe("positive");
    expect(changed.rows[0].revoked_at).not.toBeNull();
    expect(changed.rows[1].signal_type).toBe("negative");
    expect(changed.rows[1].revoked_at).toBeNull();

    expect(await setCommunicationSignalWithDatabase(database, actor, subject, "revoke")).toBe("revoked");
    expect(await setCommunicationSignalWithDatabase(database, actor, subject, "revoke")).toBe("unchanged");
    const active = await database.query(`
      SELECT count(*)::int AS count FROM reputation_signals
       WHERE actor_participant_id=$1 AND subject_participant_id=$2
         AND dimension='communication' AND revoked_at IS NULL
    `, [actor, subject]);
    expect(active.rows[0].count).toBe(0);

    const events = await database.query(`
      SELECT event_type,payload FROM events
       WHERE participant_id=$1 AND payload->>'subject_participant_id'=$2
         AND event_type LIKE 'reputation.communication_%' ORDER BY id
    `, [actor, subject]);
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "reputation.communication_created", "reputation.communication_changed", "reputation.communication_revoked",
    ]);
    expect(events.rows[1].payload).toMatchObject({ signal_type: "negative" });
    expect(events.rows[2].payload).toMatchObject({ signal_type: null });
  });

  it("rejects self-rating and relies on database checks for self-rating and invalid dimension values", async () => {
    const { actor } = await participants();
    await expect(setCommunicationSignalWithDatabase(database, actor, actor, "positive"))
      .rejects.toThrow("Cannot rate yourself");
    await expect(database.query(`
      INSERT INTO reputation_signals(actor_participant_id,subject_participant_id,dimension,signal_type)
      VALUES ($1,$1,'communication','positive')
    `, [actor])).rejects.toMatchObject({ code: "23514" });
    const { subject } = await participants();
    await expect(database.query(`
      INSERT INTO reputation_signals(actor_participant_id,subject_participant_id,dimension,signal_type)
      VALUES ($1,$2,'communication','quality_flag')
    `, [actor, subject])).rejects.toMatchObject({ code: "23514" });
    await setCommunicationSignalWithDatabase(database, actor, subject, "positive");
    await expect(database.query(`
      INSERT INTO reputation_signals(actor_participant_id,subject_participant_id,dimension,signal_type)
      VALUES ($1,$2,'communication','negative')
    `, [actor, subject])).rejects.toMatchObject({ code: "23505" });
    await expect(database.query(
      "UPDATE reputation_signals SET signal_type='negative' WHERE actor_participant_id=$1 AND subject_participant_id=$2 AND dimension='communication' AND revoked_at IS NULL",
      [actor, subject],
    )).rejects.toThrow("Only revocation of an active reputation signal is allowed");
    await expect(database.query(
      "DELETE FROM reputation_signals WHERE actor_participant_id=$1 AND subject_participant_id=$2 AND dimension='communication' AND revoked_at IS NULL",
      [actor, subject],
    )).rejects.toThrow("Reputation signal history cannot be deleted");
  });

  it("serializes concurrent operations so a pair never has duplicate active ratings", async () => {
    const { actor, subject } = await participants();
    const actions = ["positive", "negative", "positive", "negative", "positive", "negative"] as const;
    const outcomes = await Promise.all(actions.map((action) =>
      setCommunicationSignalWithDatabase(database, actor, subject, action),
    ));
    expect(outcomes.every((outcome) => ["created", "changed", "unchanged"].includes(outcome))).toBe(true);

    const rows = await database.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE revoked_at IS NULL)::int AS active
        FROM reputation_signals
       WHERE actor_participant_id=$1 AND subject_participant_id=$2 AND dimension='communication'
    `, [actor, subject]);
    expect(rows.rows[0].active).toBe(1);
    expect(rows.rows[0].total).toBeGreaterThanOrEqual(1);
    const events = await database.query(`
      SELECT count(*)::int AS count FROM events
       WHERE participant_id=$1 AND payload->>'subject_participant_id'=$2
         AND event_type LIKE 'reputation.communication_%'
    `, [actor, subject]);
    expect(events.rows[0].count).toBe(outcomes.filter((outcome) => outcome !== "unchanged").length);
  });

  it("allows a negative internal balance while clamping the public indicator, without changing core reputation", async () => {
    const { actor, subject } = await participants();
    const evaluator = (await database.query(
      "INSERT INTO participants(display_name) VALUES ('Communication test evaluator') RETURNING id",
    )).rows[0].id as string;
    await database.query(`
      INSERT INTO reputation_signals(actor_participant_id,subject_participant_id,dimension,signal_type)
      VALUES ($1,$2,'interaction_quality','positive')
    `, [actor, subject]);
    await setCommunicationSignalWithDatabase(database, actor, subject, "negative");
    await setCommunicationSignalWithDatabase(database, evaluator, subject, "negative");

    const summary = await getCommunicationSummaryWithDatabase(database, subject, actor);
    expect(summary).toEqual({ score: 0, hasRatings: true, viewerSignal: "negative" });
    const dimensions = await database.query(`
      SELECT dimension,signal_type,revoked_at FROM reputation_signals
       WHERE subject_participant_id=$1 ORDER BY dimension,created_at,id
    `, [subject]);
    expect(dimensions.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "interaction_quality", signal_type: "positive", revoked_at: null }),
      expect.objectContaining({ dimension: "communication", signal_type: "negative", revoked_at: null }),
    ]));
    expect(dimensions.rows.filter((row) => row.dimension === "interaction_quality")).toHaveLength(1);
    expect(dimensions.rows.filter((row) => row.dimension === "communication")).toHaveLength(2);
  });
});
