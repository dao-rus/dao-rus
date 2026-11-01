import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { getCommunicationSummaryWithDatabase } from "./communication-reputation";

// This suite requires a disposable PostgreSQL database with migrations applied.
const url = process.env.HUB_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("communication reputation projection: PostgreSQL integration", () => {
  let database: Pool;

  beforeAll(async () => {
    database = new Pool({ connectionString: url, max: 4 });
    const migration = await database.query(
      "SELECT 1 FROM schema_migrations WHERE name='075_communication_reaction_balances.sql'",
    );
    if (!migration.rowCount) throw new Error("Migration 075 must be applied to HUB_TEST_DATABASE_URL");
  });

  afterAll(async () => {
    if (database) await database.end();
  });

  it("projects only accumulated reaction balances and keeps the internal negative total private", async () => {
    const ids = (await database.query(
      "INSERT INTO participants(display_name) VALUES ('Projection evaluator'),('Projection evaluator two'),('Projection subject') RETURNING id",
    )).rows.map((row) => String(row.id));
    const [actor, otherActor, subject] = ids;
    await database.query(`
      INSERT INTO reputation_signals(actor_participant_id,subject_participant_id,dimension,signal_type)
      VALUES ($1,$2,'interaction_quality','positive')
    `, [actor, subject]);
    await database.query(`
      INSERT INTO communication_reaction_balances(actor_participant_id,subject_participant_id,balance)
      VALUES ($1,$3,-1),($2,$3,-1)
    `, [actor, otherActor, subject]);

    const summary = await getCommunicationSummaryWithDatabase(database, subject, actor);
    expect(summary).toEqual({ score: 0, hasRatings: true, viewerSignal: "negative" });
    expect(summary).not.toHaveProperty("balance");
    const coreReputation = await database.query(`
      SELECT count(*)::int AS count FROM reputation_signals
      WHERE subject_participant_id=$1 AND dimension='interaction_quality' AND revoked_at IS NULL
    `, [subject]);
    expect(coreReputation.rows[0].count).toBe(1);
  });

  it("distinguishes no recorded contribution from a recorded zero and exposes only the clamped score", async () => {
    const ids = (await database.query(
      "INSERT INTO participants(display_name) VALUES ('Projection positive evaluator'),('Projection negative evaluator'),('Projection positive subject'),('Projection zero subject') RETURNING id",
    )).rows.map((row) => String(row.id));
    const [positiveActor, negativeActor, subject, zeroSubject] = ids;
    await database.query(`
      INSERT INTO communication_reaction_balances(actor_participant_id,subject_participant_id,balance)
      VALUES ($1,$3,1),($2,$3,-1),($1,$4,0)
    `, [positiveActor, negativeActor, subject, zeroSubject]);

    expect(await getCommunicationSummaryWithDatabase(database, subject, positiveActor)).toEqual({
      score: 0, hasRatings: true, viewerSignal: "positive",
    });
    expect(await getCommunicationSummaryWithDatabase(database, zeroSubject, positiveActor)).toEqual({
      score: 0, hasRatings: true, viewerSignal: null,
    });
    const unrated = await database.query("INSERT INTO participants(display_name) VALUES ('Unrated projection subject') RETURNING id");
    expect(await getCommunicationSummaryWithDatabase(database, String(unrated.rows[0].id), positiveActor)).toEqual({
      score: 0, hasRatings: false, viewerSignal: null,
    });
  });
});
