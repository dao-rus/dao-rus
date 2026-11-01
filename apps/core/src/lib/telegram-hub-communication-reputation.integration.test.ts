import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

// Run only against a disposable PostgreSQL database with migrations through 075.
const url = process.env.HUB_TEST_DATABASE_URL;
let database: Pool;
let sequence = Date.now() * 1_000;
let updateSequence = Date.now() * 1_000;
const originalFeatureFlag = process.env.TELEGRAM_COMMUNICATION_REPUTATION_ENABLED;
const nextUpdateBlock = () => { updateSequence += 100; return updateSequence; };

vi.mock("./db", () => ({
  pool: {
    query: (sql: string, values?: unknown[]) => database.query(sql, values),
    connect: () => database.connect(),
  },
}));

import { getCommunicationSummaryWithDatabase } from "./communication-reputation";
import { observeHubMessage, observeHubReaction } from "./telegram-hub-reactions";
import { countHubReactions } from "./telegram-hub-moderation";

const suite = url ? describe : describe.skip;
suite("Telegram communication reputation: PostgreSQL integration", () => {
  beforeAll(async () => {
    database = new Pool({ connectionString: url, max: 10 });
    const migration = await database.query(
      "SELECT 1 FROM schema_migrations WHERE name='075_communication_reaction_balances.sql'",
    );
    if (!migration.rowCount) throw new Error("Migration 075 must be applied to HUB_TEST_DATABASE_URL");
  });

  beforeEach(() => { process.env.TELEGRAM_COMMUNICATION_REPUTATION_ENABLED = "true"; });

  afterAll(async () => {
    if (originalFeatureFlag === undefined) delete process.env.TELEGRAM_COMMUNICATION_REPUTATION_ENABLED;
    else process.env.TELEGRAM_COMMUNICATION_REPUTATION_ENABLED = originalFeatureFlag;
    if (database) await database.end();
  });

  async function participant(label: string): Promise<string> {
    const result = await database.query("INSERT INTO participants(display_name) VALUES ($1) RETURNING id", [label]);
    return String(result.rows[0].id);
  }

  async function hub(): Promise<{ id: string; chatId: number }> {
    sequence += 1;
    const id = `comm_test_${sequence}`;
    const chatId = -1_000_000_000 - sequence;
    await database.query("INSERT INTO telegram_hubs(id,chat_id,title,code_version) VALUES ($1,$2,$3,'0.1')", [id, chatId, id]);
    return { id, chatId };
  }

  async function membership(hubId: string, participantId: string, telegramId?: string): Promise<string> {
    sequence += 1;
    const memberTelegramId = telegramId ?? String(900_000_000 + sequence);
    const request = await database.query(`
      INSERT INTO telegram_hub_join_requests
        (hub_id,telegram_user_id,telegram_update_id,request_date,status,accepted_at,expires_at)
      VALUES ($1,$2,$3,now(),'accepted',now(),now()+interval '1 day') RETURNING id
    `, [hubId, memberTelegramId, sequence]);
    await database.query(`
      INSERT INTO telegram_hub_memberships
        (hub_id,participant_id,telegram_user_id,accepted_at,code_version,join_request_id)
      VALUES ($1,$2,$3,now(),'0.1',$4)
    `, [hubId, participantId, memberTelegramId, request.rows[0].id]);
    return memberTelegramId;
  }

  async function fixture(hubCount = 1) {
    const actorId = await participant("Synthetic reaction evaluator");
    const subjectId = await participant("Synthetic reaction author");
    sequence += 1;
    const actorTelegramId = String(900_000_000 + sequence);
    sequence += 1;
    const subjectTelegramId = String(900_000_000 + sequence);
    const hubs: Array<{ id: string; chatId: number; actorTelegramId: string; subjectTelegramId: string }> = [];
    for (let i = 0; i < hubCount; i += 1) {
      const created = await hub();
      const hubActorTelegramId = await membership(created.id, actorId, actorTelegramId);
      const hubSubjectTelegramId = await membership(created.id, subjectId, subjectTelegramId);
      hubs.push({ ...created, actorTelegramId: hubActorTelegramId, subjectTelegramId: hubSubjectTelegramId });
      await addMessage(hubs[i], 101 + i, Number(subjectTelegramId));
    }
    return { actorId, subjectId, hubs };
  }

  async function addMessage(
    targetHub: { chatId: number }, messageId: number, authorTelegramId: number,
  ) {
    expect(await observeHubMessage({
      message: { chat: { id: targetHub.chatId }, message_id: messageId, from: { id: authorTelegramId } },
    })).toBe(true);
  }

  function update(
    targetHub: { chatId: number }, messageId: number, actorTelegramId: number, updateId: number,
    reactions: Array<"👍" | "👎"> = [],
  ) {
    return {
      update_id: updateId,
      message_reaction: {
        chat: { id: targetHub.chatId }, message_id: messageId,
        date: Math.floor(Date.now() / 1000), user: { id: actorTelegramId },
        new_reaction: reactions.map((emoji) => ({ type: "emoji", emoji })),
      },
    };
  }

  async function balance(actorId: string, subjectId: string): Promise<number | null> {
    const result = await database.query(`
      SELECT balance FROM communication_reaction_balances
      WHERE actor_participant_id=$1 AND subject_participant_id=$2
    `, [actorId, subjectId]);
    return result.rowCount ? Number(result.rows[0].balance) : null;
  }

  it("counts only changed thumbs-up/down states; removal and duplicate delivery do not reverse or repeat accrual", async () => {
    const { actorId, subjectId, hubs: [targetHub] } = await fixture();
    const actor = Number(targetHub.actorTelegramId);
    const first = nextUpdateBlock();
    await observeHubReaction(update(targetHub, 101, actor, first, ["👍"]));
    await observeHubReaction(update(targetHub, 101, actor, first, ["👍"]));
    await observeHubReaction(update(targetHub, 101, actor, first + 1, ["👍"]));
    expect(await balance(actorId, subjectId)).toBe(1);

    await observeHubReaction(update(targetHub, 101, actor, first + 2, ["👎"]));
    expect(await balance(actorId, subjectId)).toBe(0);
    await observeHubReaction(update(targetHub, 101, actor, first + 3));
    expect(await balance(actorId, subjectId)).toBe(0);
    await observeHubReaction(update(targetHub, 101, actor, first + 4, ["👎"]));
    expect(await balance(actorId, subjectId)).toBe(-1);
    await observeHubReaction(update(targetHub, 101, actor, first + 5));
    expect(await balance(actorId, subjectId)).toBe(-1);

    const events = await database.query(`
      SELECT delta FROM communication_reaction_events
      WHERE actor_participant_id=$1 AND subject_participant_id=$2 ORDER BY telegram_update_id
    `, [actorId, subjectId]);
    expect(events.rows.map((row) => Number(row.delta))).toEqual([1, -1, -1]);
  });

  it("clamps each contribution at both boundaries and lets an opposite reaction move it one step", async () => {
    const positive = await fixture();
    const base = nextUpdateBlock();
    const positiveActor = Number(positive.hubs[0].actorTelegramId);
    await addMessage(positive.hubs[0], 201, Number(positive.hubs[0].subjectTelegramId));
    await addMessage(positive.hubs[0], 202, Number(positive.hubs[0].subjectTelegramId));
    await observeHubReaction(update(positive.hubs[0], 101, positiveActor, base, ["👍"]));
    await observeHubReaction(update(positive.hubs[0], 201, positiveActor, base + 1, ["👍"]));
    await observeHubReaction(update(positive.hubs[0], 202, positiveActor, base + 2, ["👎"]));
    expect(await balance(positive.actorId, positive.subjectId)).toBe(0);

    const negative = await fixture();
    const negativeActor = Number(negative.hubs[0].actorTelegramId);
    await addMessage(negative.hubs[0], 301, Number(negative.hubs[0].subjectTelegramId));
    await addMessage(negative.hubs[0], 302, Number(negative.hubs[0].subjectTelegramId));
    await addMessage(negative.hubs[0], 303, Number(negative.hubs[0].subjectTelegramId));
    await observeHubReaction(update(negative.hubs[0], 101, negativeActor, base + 3, ["👎"]));
    await observeHubReaction(update(negative.hubs[0], 301, negativeActor, base + 4, ["👍"]));
    await observeHubReaction(update(negative.hubs[0], 302, negativeActor, base + 5, ["👍"]));
    expect(await balance(negative.actorId, negative.subjectId)).toBe(1);
    await observeHubReaction(update(negative.hubs[0], 303, negativeActor, base + 6, ["👎"]));
    expect(await balance(negative.actorId, negative.subjectId)).toBe(0);
  }, 15_000);

  it("re-folds out-of-order and concurrent transitions by Telegram update_id across messages and hubs", async () => {
    const { actorId, subjectId, hubs } = await fixture(2);
    const actor = Number(hubs[0].actorTelegramId);
    const base = nextUpdateBlock();
    await addMessage(hubs[0], 401, Number(hubs[0].subjectTelegramId));
    await addMessage(hubs[1], 402, Number(hubs[1].subjectTelegramId));
    await addMessage(hubs[0], 403, Number(hubs[0].subjectTelegramId));

    // Deliver the last transition first. In Telegram order the sequence is
    // +1,+1,-1 => 0; arrival-order clamping would incorrectly finish at +1.
    await observeHubReaction(update(hubs[0], 403, actor, base + 2, ["👎"]));
    await Promise.all([
      observeHubReaction(update(hubs[0], 401, actor, base, ["👍"])),
      observeHubReaction(update(hubs[1], 402, actor, base + 1, ["👍"])),
    ]);
    expect(await balance(actorId, subjectId)).toBe(0);
    const rows = await database.query(`
      SELECT telegram_update_id,delta FROM communication_reaction_events
      WHERE actor_participant_id=$1 AND subject_participant_id=$2 ORDER BY telegram_update_id
    `, [actorId, subjectId]);
    expect(rows.rows.map((row) => Number(row.delta))).toEqual([1, 1, -1]);
  }, 15_000);

  it("ignores stale same-message updates and does not count unknown or self identities", async () => {
    const { actorId, subjectId, hubs: [targetHub] } = await fixture();
    const actor = Number(targetHub.actorTelegramId);
    const base = nextUpdateBlock();
    await observeHubReaction(update(targetHub, 101, actor, base + 1, ["👍"]));
    await observeHubReaction(update(targetHub, 101, actor, base, ["👎"]));
    await observeHubReaction(update(targetHub, 101, actor, base + 1, ["👍"]));
    expect(await balance(actorId, subjectId)).toBe(1);
    expect((await database.query("SELECT count(*)::int AS count FROM communication_reaction_events WHERE actor_participant_id=$1 AND subject_participant_id=$2", [actorId, subjectId])).rows[0].count).toBe(1);

    await observeHubReaction(update(targetHub, 101, Number(targetHub.subjectTelegramId), base + 2, ["👎"]));
    await observeHubReaction(update(targetHub, 101, 999_999_999, base + 3, ["👎"]));
    const unknownAuthorId = 888_888_888;
    await addMessage(targetHub, 501, unknownAuthorId);
    await observeHubReaction(update(targetHub, 501, actor, base + 4, ["👎"]));
    expect(await balance(actorId, subjectId)).toBe(1);
    expect((await database.query("SELECT count(*)::int AS count FROM communication_reaction_events WHERE actor_participant_id=$1 AND subject_participant_id=$2", [actorId, subjectId])).rows[0].count).toBe(1);
  });

  it("honors the opt-in flag and does not change core reputation or 24-hour moderation counts", async () => {
    const { actorId, subjectId, hubs: [targetHub] } = await fixture();
    const actor = Number(targetHub.actorTelegramId);
    await database.query(`
      INSERT INTO reputation_signals(actor_participant_id,subject_participant_id,dimension,signal_type)
      VALUES ($1,$2,'interaction_quality','positive')
    `, [actorId, subjectId]);
    process.env.TELEGRAM_COMMUNICATION_REPUTATION_ENABLED = "false";
    const base = nextUpdateBlock();
    await observeHubReaction(update(targetHub, 101, actor, base, ["👎"]));
    expect(await balance(actorId, subjectId)).toBeNull();
    process.env.TELEGRAM_COMMUNICATION_REPUTATION_ENABLED = "true";
    await observeHubReaction(update(targetHub, 101, actor, base + 1, ["👎"]));
    expect(await balance(actorId, subjectId)).toBeNull();
    await observeHubReaction(update(targetHub, 101, actor, base + 2, ["👍"]));
    expect(await balance(actorId, subjectId)).toBe(1);

    const primary = await database.query(`
      SELECT count(*)::int AS count FROM reputation_signals
      WHERE actor_participant_id=$1 AND subject_participant_id=$2 AND dimension='interaction_quality' AND revoked_at IS NULL
    `, [actorId, subjectId]);
    expect(primary.rows[0].count).toBe(1);
    expect((await countHubReactions(targetHub.id, targetHub.subjectTelegramId)).negative).toBe(0);
    expect((await countHubReactions(targetHub.id, targetHub.subjectTelegramId)).positive).toBe(1);
    expect((await getCommunicationSummaryWithDatabase(database, subjectId, actorId)).score).toBe(1);
  });
});
