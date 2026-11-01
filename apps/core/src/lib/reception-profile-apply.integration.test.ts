import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyReceptionDraftWithClient } from "./reception-profile-apply";
import { createReceptionProfileDraft } from "./reception-profile-draft";
import { observeForumMembership } from "./telegram-forum-onboarding";
import { saveReceptionApplication } from "./reception-applications";
import { saveProfileWithDatabase, getVisibleProfileAboutWithDatabase } from "./profile-about";
import { ensureTestPgcrypto } from "./test-postgres-extensions";

vi.mock("./config", () => ({ telegramReceptionConfig: () => ({ miniAppEnabled: false }), appBaseUrl: () => "https://core.test" }));
vi.mock("./interface-texts", () => ({ readInterfaceTexts: async () => ({ values: {} }) }));
const databaseUrl = process.env.RECEPTION_TEST_DATABASE_URL;
const schema = `reception_apply_${randomUUID().replaceAll("-", "")}`;
const db = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, application_name: schema, max: 12 });
let created = false;
let participantId: string;
let participantCount: number;
async function waitForRowLock() {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const result = await db.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [schema]);
    if (result.rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Expected a real concurrent row lock wait");
}
async function transaction() {
  const c = await db.connect();
  await c.query("BEGIN");
  return c;
}
async function apply() {
  const c = await transaction();
  try { const result = await applyReceptionDraftWithClient(c, "42"); await c.query("COMMIT"); return result; }
  catch (error) { await c.query("ROLLBACK"); throw error; }
  finally { c.release(); }
}
async function draft(text = "39 лет, Киров Калужская область, предприниматель") {
  return createReceptionProfileDraft("42", text, 100, db);
}
async function join() {
  return observeForumMembership(db, "42", true, new Date(), null, "chat_member", 101, false, { wasJoined: false, status: "member" });
}
async function person() { return (await db.query("SELECT * FROM participants WHERE id=$1", [participantId])).rows[0]; }
async function audits() { return (await db.query("SELECT payload FROM events WHERE event_type='participant.reception_profile_applied' AND participant_id=$1", [participantId])).rows; }

describe.skipIf(!databaseUrl)("Reception draft projection on PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/reception_tests") throw new Error("Use isolated local reception_tests");
    await db.query(`CREATE SCHEMA ${schema}`); created = true;
    await ensureTestPgcrypto(db);
    const dir = new URL("../../migrations/", import.meta.url);
    for (const name of readdirSync(dir).filter(name => name.endsWith(".sql")).sort()) {
      await db.query("BEGIN;" + readFileSync(new URL(name, dir), "utf8") + ";COMMIT;");
    }
  }, 60000);
  beforeEach(async () => {
    await db.query("TRUNCATE reception_applications, reception_relay_updates CASCADE");
    await db.query("DELETE FROM telegram_roster_entries WHERE telegram_user_id=42");
    await db.query("DELETE FROM external_identities WHERE external_user_id='42'");
    participantId = (await db.query("INSERT INTO participants(display_name) VALUES('Synthetic') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO external_identities(participant_id,provider,provider_subject,external_user_id) VALUES($1,'telegram','roster:42','42')", [participantId]);
    await db.query(`INSERT INTO reception_relay_updates(update_id,direction,forum_chat_id,private_chat_id,private_message_id,forum_message_id,status)
      VALUES(100,'private_to_forum',-100123,42,1,2,'sent')`);
    participantCount = (await db.query("SELECT count(*)::int AS count FROM participants")).rows[0].count;
  });
  afterAll(async () => { if (created) await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });

  it.each(["draft_first", "join_first"])("applies in both orders: %s, duplicates remain idempotent and personal fields stay private", async order => {
    if (order === "draft_first") { await draft(); expect((await person()).residence_name).toBeNull(); await join(); }
    else { await join(); await draft(); }
    await Promise.all(Array.from({ length: 5 }, () => apply()));
    await draft(); await join();
    expect(await person()).toMatchObject({ residence_name: "Киров Калужская область", profile_occupation: "предприниматель", profile_age: null, profile_education: null, profile_family_status: null, residence_type: null, residence_country: null });
    expect((await db.query("SELECT status,participant_id,age FROM reception_applications")).rows[0]).toEqual({ status: "draft", participant_id: participantId, age: 39 });
    expect(await audits()).toHaveLength(1);
    expect((await db.query("SELECT count(*)::int AS count FROM participants")).rows[0].count).toBe(participantCount);
    expect(await getVisibleProfileAboutWithDatabase(db, participantId, randomUUID(), false))
      .toMatchObject({ city: "Киров Калужская область", occupation: "предприниматель", age: null, education: null, familyStatus: null });
  });
  it("serializes simultaneous join, draft and duplicate updates", async () => {
    await Promise.all([join(), draft(), draft(), join()]);
    expect(await person()).toMatchObject({ residence_name: "Киров Калужская область", profile_occupation: "предприниматель" });
    expect(await audits()).toHaveLength(1);
  });
  it("preserves a partially filled profile field by field", async () => {
    await db.query("UPDATE participants SET residence_name='Свой город' WHERE id=$1", [participantId]);
    await draft(); await join();
    expect(await person()).toMatchObject({ residence_name: "Свой город", profile_occupation: "предприниматель" });
    expect((await audits())[0].payload.fields).toEqual(["profile_occupation"]);
  });
  it("does not change existing personal fields when the draft contains different values", async () => {
    await db.query("UPDATE participants SET profile_age=70,profile_education='Личное',profile_family_status='Личное' WHERE id=$1", [participantId]);
    await draft("Мне 39 лет. Город: Москва. Профессия: мастер. Образование: высшее. Семейное положение: женат.");
    await join();
    expect(await person()).toMatchObject({ profile_age: 70, profile_education: "Личное", profile_family_status: "Личное", residence_name: "Москва", profile_occupation: "мастер" });
    expect(await getVisibleProfileAboutWithDatabase(db, participantId, randomUUID(), false))
      .toMatchObject({ city: "Москва", occupation: "мастер", age: null, education: null, familyStatus: null });
  });
  it.each(["identity", "application"])("refuses %s conflicts without creating Participants or blocking membership", async kind => {
    await draft();
    const other = (await db.query("INSERT INTO participants(display_name) VALUES('Other') RETURNING id")).rows[0].id;
    if (kind === "application") await db.query("UPDATE reception_applications SET participant_id=$1", [other]);
    else await db.query("INSERT INTO telegram_roster_entries(telegram_user_id,display_name,is_bot,participant_id,observed_at,telegram_presence_observed_at) VALUES(42,'Other',false,$1,now(),now())", [other]);
    await join();
    expect((await db.query("SELECT forum_status FROM participant_forum_onboarding WHERE participant_id=$1", [participantId])).rows[0].forum_status).toBe("joined");
    await expect(apply()).rejects.toThrow("conflicting Participant");
    expect((await person()).residence_name).toBeNull();
    expect(await audits()).toHaveLength(0);
  });
  it.each(["forum_to_private", "failed"])("requires successful original private relay: %s", async invalid => {
    await db.query(invalid === "failed" ? "UPDATE reception_relay_updates SET status='failed'" : "UPDATE reception_relay_updates SET direction='forum_to_private'");
    await join(); await draft();
    expect((await person()).residence_name).toBeNull();
  });
  it("does not create a missing identity or project after a newer departure", async () => {
    await draft(); await db.query("DELETE FROM external_identities WHERE external_user_id='42'");
    expect((await apply()).participantId).toBeNull();
    expect((await db.query("SELECT count(*)::int AS count FROM participants")).rows[0].count).toBe(participantCount);
    await db.query("INSERT INTO external_identities(participant_id,provider,provider_subject,external_user_id) VALUES($1,'telegram','roster:42','42')", [participantId]);
    const later = new Date(Date.now() + 60000);
    await observeForumMembership(db, "42", false, later, null);
    await join();
    expect((await person()).residence_name).toBeNull();
  });
  it.each(["city", "occupation"])("one invalid %s does not block the other field or draft insertion", async invalid => {
    await join();
    await draft(invalid === "city" ? `город: ${"я".repeat(201)}. Профессия: бухгалтер` : `город: Москва. Профессия: ${"я".repeat(1001)}`);
    expect(await person()).toMatchObject(invalid === "city" ? { residence_name: null, profile_occupation: "бухгалтер" } : { residence_name: "Москва", profile_occupation: null });
  });
  it("rejects ambiguous city independently, and does not treat origin as residence", async () => {
    await join(); await draft("Город: Москва или Тверь. Родом из Казани. Профессия: бухгалтер");
    expect(await person()).toMatchObject({ residence_name: null, profile_occupation: "бухгалтер" });
  });
  it("waits for a concurrent manual row update and preserves it", async () => {
    await draft();
    const manual = await transaction();
    await manual.query("UPDATE participants SET residence_name='Ручной город',profile_occupation='Ручное занятие' WHERE id=$1", [participantId]);
    const joining = join();
    await waitForRowLock();
    await manual.query("COMMIT"); manual.release();
    await joining;
    expect(await person()).toMatchObject({ residence_name: "Ручной город", profile_occupation: "Ручное занятие" });
    expect(await audits()).toHaveLength(0);
  });
  it("a real profile edit wins after automatic apply, including an intentional clear", async () => {
    await join();
    await db.query(`INSERT INTO reception_applications(telegram_user_id,status,city,occupation,source_message_update_id)
      VALUES('42','draft','Москва','Мастер',100)`);
    const automatic = await transaction();
    await applyReceptionDraftWithClient(automatic, "42");
    const manual = saveProfileWithDatabase(db, participantId, "Synthetic", "", "members", { name: "" });
    await waitForRowLock();
    await automatic.query("COMMIT"); automatic.release();
    await manual;
    await apply(); await draft(); await join();
    expect((await person()).residence_name).toBeNull();
    expect(await audits()).toHaveLength(1);
  });
  it("does not fill a residence previously cleared by the participant before first application", async () => {
    await db.query("UPDATE participants SET residence_name='Ручной' WHERE id=$1", [participantId]);
    await saveProfileWithDatabase(db, participantId, "Synthetic", "", "members", { name: "" });
    await draft(); await join();
    expect(await person()).toMatchObject({ residence_name: null, profile_occupation: "предприниматель" });
  });
  it("Mini App can correct automatic values, but resubmission preserves a manual profile edit", async () => {
    await draft(); await join();
    const form = { city: "Уточнённый город", occupation: "Мастер", age: null, education: null, familyStatus: null, publishAge: false };
    await saveReceptionApplication("42", form, true, db);
    expect(await person()).toMatchObject({ residence_name: form.city, profile_occupation: "Мастер", profile_age: null });
    await saveProfileWithDatabase(db, participantId, "Synthetic", "", "members", { name: "Ручной город" });
    await saveReceptionApplication("42", { ...form, city: "Новый город", occupation: "Новое занятие" }, true, db);
    await apply();
    expect(await person()).toMatchObject({ residence_name: "Ручной город", profile_occupation: "Мастер" });
    expect((await db.query("SELECT status FROM reception_applications")).rows[0].status).toBe("submitted");
  });
  it("confirmation does not replace an independently edited automatic residence", async () => {
    await draft(); await join();
    await saveProfileWithDatabase(db, participantId, "Synthetic", "", "members", { name: "Ручной город" });
    await saveReceptionApplication("42", { city: "Анкета", occupation: "Мастер", age: null, publishAge: false }, true, db);
    expect(await person()).toMatchObject({ residence_name: "Ручной город", profile_occupation: "Мастер" });
  });
});
