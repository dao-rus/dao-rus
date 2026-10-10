import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processNextReceptionInvitation, expireReceptionPublicationClaims } from "./reception-publication";
import { saveReceptionApplication } from "./reception-applications";
import { listReceptionApplications, requestReceptionInvitation, reviewReceptionDelivery } from "./reception-admin";
import { checkForumAndInvite, type ForumBot } from "./telegram-forum-onboarding";
import { telegramReceptionConfig } from "./config";

const url = process.env.RECEPTION_TEST_DATABASE_URL;
const schema = `reception_invitation_test_${randomUUID().replaceAll("-", "")}`;
const db = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 16 });
const config = { ...telegramReceptionConfig(), guardianInvitesEnabled: true, token: "synthetic", forumChatId: "-100123", forumInviteUrl: "https://t.me/+example" };
const form = { city: "Тверь", occupation: "Мастер", age: null, publishAge: false };
let actor: string, created = false;
const save = async () => (await saveReceptionApplication("168", form, false, db)).application;
const row = async () => (await db.query("SELECT * FROM reception_application_deliveries WHERE kind='invitation'")).rows[0];
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
const member = (status = "left", id = 168) => response({ ok: true, result: { status, user: { id } } });
const transport = (status = "left") => vi.fn<typeof fetch>().mockImplementation(async target =>
  String(target).endsWith("/getChatMember") ? member(status) : response({ ok: true, result: { message_id: 77, chat: { id: 168 } } }));
const processInvite = (send = transport()) => processNextReceptionInvitation(db, config, send);
async function identity() {
  const p = (await db.query("INSERT INTO participants(display_name) VALUES ('Preserved candidate profile') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO external_identities(participant_id,provider,provider_subject,external_user_id) VALUES ($1,'telegram','miniapp:168','168')", [p]);
  return p;
}

describe.skipIf(!url)("Guardian invitations on isolated PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/reception_tests") throw new Error("Use isolated local reception_tests");
    await db.query(`CREATE SCHEMA ${schema}`); created = true;
    const dir = new URL("../../migrations/", import.meta.url);
    for (const name of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) await db.query(readFileSync(new URL(name, dir), "utf8"));
    actor = (await db.query("INSERT INTO participants(display_name) VALUES ('Guardian') RETURNING id")).rows[0].id;
    vi.stubEnv("ADMIN_PARTICIPANT_IDS", actor); vi.stubEnv("TELEGRAM_RECEPTION_BOT_TOKEN", "synthetic");
    vi.stubEnv("TELEGRAM_FORUM_CHAT_ID", "-100123"); vi.stubEnv("TELEGRAM_FORUM_INVITE_URL", "https://t.me/+example");
    vi.stubEnv("TELEGRAM_GUARDIAN_INVITES_ENABLED", "true");
  }, 60000);
  beforeEach(async () => { await db.query("TRUNCATE reception_applications CASCADE"); await db.query("DELETE FROM events"); await db.query("DELETE FROM ui_text_overrides"); await db.query("DELETE FROM telegram_roster_entries"); await db.query("DELETE FROM participants WHERE id<>$1", [actor]); });
  afterAll(async () => { vi.unstubAllEnvs(); if (created) await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });
  it("requires explicit admin authority before creating a decision", async () => {
    const a = await save(); await expect(requestReceptionInvitation(randomUUID(), a.id, db)).rejects.toThrow("forbidden");
    expect(await row()).toBeUndefined();
  });
  it("records one human decision and one task under concurrent repeated clicks", async () => {
    const a = await save(); await Promise.all(Array.from({ length: 8 }, () => requestReceptionInvitation(actor, a.id, db)));
    expect(await row()).toMatchObject({ status: "pending", requested_by: actor, attempts: 0 });
    expect((await db.query("SELECT count(*)::int AS count FROM events WHERE event_type='reception.invitation_requested'")).rows[0].count).toBe(1);
    expect((await db.query("SELECT count(*)::int AS count FROM reception_application_deliveries WHERE kind='invitation'")).rows[0].count).toBe(1);
  });
  it("never sends before a decision or when the existing invitation flag is off", async () => {
    const a = await save(); const send = transport(); expect(await processInvite(send)).toBeNull();
    await requestReceptionInvitation(actor, a.id, db);
    expect(await processNextReceptionInvitation(db, { ...config, guardianInvitesEnabled: false }, send)).toBeNull(); expect(send).not.toHaveBeenCalled();
  });
  it("ignores invitation rows without a recorded human decision", async () => {
    const a = await save(); await db.query("INSERT INTO reception_application_deliveries(application_id,kind) VALUES ($1,'invitation')", [a.id]);
    const send = transport(); expect(await processInvite(send)).toBeNull(); expect(send).not.toHaveBeenCalled();
  });
  it("sends once through two workers, keeps delivery separate from membership and never creates a Participant", async () => {
    const a = await save(); await requestReceptionInvitation(actor, a.id, db); const send = transport();
    const before = (await db.query("SELECT * FROM participants")).rows;
    const results = await Promise.all([processInvite(send), processInvite(send)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(send.mock.calls.filter(([target]) => String(target).endsWith("sendMessage"))).toHaveLength(1);
    expect(await row()).toMatchObject({ status: "delivered", telegram_chat_id: "168", telegram_message_id: "77" });
    expect((await db.query("SELECT * FROM participants")).rows).toEqual(before);
    await saveReceptionApplication("168", { ...form, occupation: "Правки" }, false, db);
    await requestReceptionInvitation(actor, a.id, db); expect(await processInvite(send)).toBeNull();
    expect((await db.query("SELECT payload->>'meaning' AS meaning FROM events WHERE event_type='reception.invitation_result'")).rows).toEqual([{ meaning: "sent_not_received_or_joined" }]);
  });
  it("skips an already joined person without assigning DAO membership", async () => {
    const a = await save(); await requestReceptionInvitation(actor, a.id, db); const send = transport("member");
    expect(await processInvite(send)).toMatchObject({ status: "already_joined" });
    expect(await row()).toMatchObject({ status: "failed", error_code: "already_joined", telegram_message_id: null, attempts: 0 });
    expect(send).toHaveBeenCalledOnce(); expect((await listReceptionApplications(actor, db))[0].invitation_error_code).toBe("already_joined");
    expect((await db.query("SELECT count(*)::int AS count FROM participants")).rows[0].count).toBe(1);
  });
  it("uses the existing text registry as plain text and always appends the configured forum link", async () => {
    const a = await save(); await requestReceptionInvitation(actor, a.id, db);
    await db.query("INSERT INTO ui_text_overrides(key,value) VALUES ('reception.invitation.message','<b>Приглашение</b>')");
    const send = transport(); await processInvite(send);
    const call = send.mock.calls.find(([target]) => String(target).endsWith("sendMessage"))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ chat_id: "168", text: `<b>Приглашение</b>\n\n${config.forumInviteUrl}` });
    expect((await row()).attempted_text).toBeNull();
  });
  it.each(["timeout", "wrong_user"])("does not send when the membership read is %s", async kind => {
    const a = await save(); await requestReceptionInvitation(actor, a.id, db);
    const send = vi.fn<typeof fetch>().mockImplementation(async () => { if (kind === "timeout") throw new Error("read timeout"); return member("left", 169); });
    expect(await processInvite(send)).toMatchObject({ status: "pending" });
    expect(await row()).toMatchObject({ attempts: 0, attempted_at: null, error_code: "membership_unavailable" }); expect(send).toHaveBeenCalledOnce();
  });
  it.each(["timeout", "server", "invalid"])("requires review for uncertain send: %s", async kind => {
    const a = await save(); await requestReceptionInvitation(actor, a.id, db);
    const send = vi.fn<typeof fetch>().mockImplementation(async target => {
      if (String(target).endsWith("getChatMember")) return member();
      if (kind === "timeout") throw new Error("synthetic timeout");
      return kind === "server" ? response({ ok: false, error_code: 500 }, 500) : new Response("invalid");
    });
    expect(await processInvite(send)).toMatchObject({ status: "needs_review" }); expect(await processInvite(send)).toBeNull(); expect(send).toHaveBeenCalledTimes(2);
  });
  it("retries an explicit refusal respecting retry_after and rechecks membership first", async () => {
    const a = await save(); await requestReceptionInvitation(actor, a.id, db);
    const send = vi.fn<typeof fetch>().mockImplementation(async target => String(target).endsWith("getChatMember") ? member()
      : response({ ok: false, error_code: 429, parameters: { retry_after: 120 } }, 429));
    expect(await processInvite(send)).toMatchObject({ status: "pending" }); expect((await row()).retry_at.getTime()-Date.now()).toBeGreaterThan(115000);
    expect(await processInvite(send)).toBeNull(); await db.query("UPDATE reception_application_deliveries SET retry_at=now()-interval '1 second' WHERE kind='invitation'");
    expect(await processInvite(transport("member"))).toMatchObject({ status: "already_joined" });
  });
  it.each([false, true])("recovers a worker restart with possible-send marker=%s", async attempted => {
    const a = await save(); await requestReceptionInvitation(actor, a.id, db);
    await db.query("UPDATE reception_application_deliveries SET status='processing',claim_token=$1,claimed_at=now()-interval '11 minutes',attempted_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE kind='invitation'", [randomUUID(), attempted]);
    await expireReceptionPublicationClaims(db, "invitation");
    expect((await row()).status).toBe(attempted ? "needs_review" : "pending");
    const send = transport(); await processInvite(send); expect(send).toHaveBeenCalledTimes(attempted ? 0 : 2);
    expect((await db.query("SELECT count(*)::int AS count FROM events WHERE event_type='reception.invitation_recovered'")).rows[0].count).toBe(1);
  });
  it("requires manual proof, fences stale recovery and does not send again after confirmed delivery", async () => {
    const a = await save(); await requestReceptionInvitation(actor, a.id, db);
    const send = vi.fn<typeof fetch>().mockImplementation(async target => { if (String(target).endsWith("getChatMember")) return member(); throw new Error("timeout"); });
    await processInvite(send); const d = await row();
    const input = { id: a.id, kind: "invitation" as const, action: "confirm" as const, version: d.version, verified: true, messageId: "77" };
    await expect(reviewReceptionDelivery(randomUUID(), input, db)).rejects.toThrow("forbidden");
    await expect(reviewReceptionDelivery(actor, { ...input, verified: false }, db)).rejects.toThrow("confirmation_required");
    await reviewReceptionDelivery(actor, input, db); expect((await row()).status).toBe("delivered"); expect(await processInvite()).toBeNull();
    await expect(reviewReceptionDelivery(actor, { ...input, action: "retry" }, db)).rejects.toThrow("conflict");
    expect((await db.query("SELECT payload->>'kind' AS kind FROM events WHERE event_type='reception.delivery_review'")).rows).toEqual([{ kind: "invitation" }]);
  });
  it("allows a manually confirmed absent invitation to be retried", async () => {
    const a = await save(); await requestReceptionInvitation(actor, a.id, db);
    await processInvite(vi.fn<typeof fetch>().mockImplementation(async target => { if (String(target).endsWith("getChatMember")) return member(); throw new Error("timeout"); }));
    const d = await row(); await reviewReceptionDelivery(actor, { id: a.id, kind: "invitation", action: "retry", version: d.version, verified: true }, db);
    expect(await processInvite()).toMatchObject({ status: "delivered" });
  });
  it.each([true, false])("quarantines prior legacy invitations, confirmed-sent=%s", async sent => {
    const p = await identity(); const a = await save();
    await db.query("INSERT INTO participant_forum_onboarding(participant_id,forum_status,observed_at,invitation_attempted_at,invitation_sent_at) VALUES($1,'absent',now(),now(),CASE WHEN $2 THEN now() ELSE NULL END)", [p, sent]);
    await requestReceptionInvitation(actor, a.id, db);
    expect(await row()).toMatchObject({ status: "needs_review", error_code: sent ? "legacy_invitation_sent" : "legacy_invitation_unknown" }); expect(await processInvite()).toBeNull();
  });
  it.each(["start", "login"] as const)("blocks the old auto-invite on %s even after Guardian approval", async source => {
    await identity(); const a = await save(); await requestReceptionInvitation(actor, a.id, db);
    const bot: ForumBot = { getMember: vi.fn(async () => false), sendInvite: vi.fn(async () => "sent" as const) };
    await checkForumAndInvite("168", source, db, bot); expect(bot.sendInvite).not.toHaveBeenCalled();
    expect((await row()).status).toBe("pending");
  });
  it("serializes an in-flight legacy auto-invite with submission and then preserves its uncertain outcome", async () => {
    await identity(); let started!: () => void, release!: () => void;
    const ready = new Promise<void>(r => { started = r; }); const wait = new Promise<void>(r => { release = r; });
    const bot: ForumBot = { getMember: vi.fn(async () => false), sendInvite: vi.fn(async () => { started(); await wait; return "unknown" as const; }) };
    const legacy = checkForumAndInvite("168", "start", db, bot); await ready;
    const saving = save(); release(); await legacy; const a = await saving;
    await requestReceptionInvitation(actor, a.id, db); expect((await row()).status).toBe("needs_review"); expect(await processInvite()).toBeNull();
  });
  it("quarantines a successful send whose result/event transaction failed", async () => {
    const a = await save(); await requestReceptionInvitation(actor, a.id, db); const send = transport();
    const failing = { query: db.query.bind(db), connect: async () => {
      const c = await db.connect();
      return { query: async (sql: string, values?: unknown[]) => {
        if (sql.includes("reception.invitation_result")) throw new Error("Synthetic audit failure");
        return c.query(sql, values);
      }, release: c.release.bind(c) };
    } } as unknown as Pool;
    await expect(processNextReceptionInvitation(failing, config, send)).rejects.toThrow("Synthetic audit failure");
    expect(await row()).toMatchObject({ status: "processing", attempts: 1, telegram_message_id: null });
    await db.query("UPDATE reception_application_deliveries SET claimed_at=now()-interval '11 minutes' WHERE kind='invitation'");
    await expireReceptionPublicationClaims(db, "invitation"); expect((await row()).status).toBe("needs_review");
    expect(await processInvite(send)).toBeNull(); expect(send).toHaveBeenCalledTimes(2);
  });
  it("records a deterministic Telegram refusal without marking the invitation sent", async () => {
    const a = await save(); await requestReceptionInvitation(actor, a.id, db);
    const send = vi.fn<typeof fetch>().mockImplementation(async target => String(target).endsWith("getChatMember") ? member() : response({ ok: false, error_code: 403, description: "blocked" }, 403));
    await processInvite(send); expect(await row()).toMatchObject({ status: "pending", error_code: "telegram_403", telegram_message_id: null });
    expect(await processInvite(send)).toBeNull();
  });
  it("keeps existing Core profile, identity and membership unchanged when sending", async () => {
    const p = await identity(); const a = await save();
    const before = (await db.query("SELECT * FROM participants WHERE id=$1", [p])).rows;
    const identityBefore = (await db.query("SELECT * FROM external_identities WHERE participant_id=$1", [p])).rows;
    await requestReceptionInvitation(actor, a.id, db); await processInvite();
    expect((await db.query("SELECT * FROM participants WHERE id=$1", [p])).rows).toEqual(before);
    expect((await db.query("SELECT * FROM external_identities WHERE participant_id=$1", [p])).rows).toEqual(identityBefore);
  });
  it("rejects a newly conflicting Telegram identity instead of creating an invitation", async () => {
    await identity(); const a = await save();
    const p = (await db.query("INSERT INTO participants(display_name) VALUES ('Conflict') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO telegram_roster_entries(telegram_user_id,display_name,is_bot,participant_id,observed_at,telegram_presence_observed_at) VALUES(168,'Conflict',false,$1,now(),now())", [p]);
    await expect(requestReceptionInvitation(actor, a.id, db)).rejects.toThrow("identity_conflict"); expect(await row()).toBeUndefined();
  });
  it("does not send when the durable attempt marker was rejected by the claim fence", async () => {
    const a = await save(); await requestReceptionInvitation(actor, a.id, db); const send = transport();
    const fenced = { query: db.query.bind(db), connect: async () => {
      const c = await db.connect();
      return { query: async (sql: string, values?: unknown[]) => sql.includes("SET attempted_at=now()")
        ? { rowCount: 0, rows: [] } : c.query(sql, values), release: c.release.bind(c) };
    } } as unknown as Pool;
    expect(await processNextReceptionInvitation(fenced, config, send)).toBeNull();
    expect(send).toHaveBeenCalledTimes(1); expect((await row()).attempted_at).toBeNull();
  });
});
