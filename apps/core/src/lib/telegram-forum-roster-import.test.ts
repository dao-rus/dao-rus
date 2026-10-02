import { describe, expect, it } from "vitest";
import {
  applyTelegramForumRosterImport,
  previewTelegramForumRosterImport,
} from "./telegram-forum-roster-import";
import type { TelegramRosterDatabaseClient } from "./telegram-roster";

const forumChatId = "-1001234567890";
const observedAt = "2026-10-02T09:00:00.000Z";
const now = new Date("2026-10-02T10:00:00.000Z");
const existingParticipant = "10000000-0000-4000-8000-000000000001";
const otherParticipant = "20000000-0000-4000-8000-000000000002";

function snapshot(entries: Array<{ id: string; isBot?: boolean }> = [
  { id: "42" }, { id: "43" }, { id: "44", isBot: true },
]) {
  return {
    observed_at: observedAt,
    chat: { id: "1234567890", title: "Ignored" },
    entries: entries.map((entry) => ({
      telegram_user_id: entry.id,
      display_name: "Ignored name",
      username: null,
      is_bot: entry.isBot ?? false,
    })),
  };
}

type RosterRow = { participantId: string | null; observedAt: string };
type IdentityRow = { id: string; participantId: string; userId: string | null; subject: string };
type OnboardingRow = { status: string; observedAt: string };

class FakeDatabase {
  roster = new Map<string, RosterRow>();
  identities: IdentityRow[] = [];
  onboarding = new Map<string, OnboardingRow>();
  participants = new Set<string>();
  events: string[] = [];
  writes = 0;
  private nextParticipant = 2;
  private readOnly = false;

  async connect(): Promise<TelegramRosterDatabaseClient> {
    return { query: this.query.bind(this), release() {} };
  }

  async query(sql: string, values: unknown[] = []) {
    if (sql.startsWith("BEGIN")) {
      this.readOnly = sql.includes("READ ONLY");
      return { rowCount: 0, rows: [] };
    }
    if (sql === "COMMIT" || sql === "ROLLBACK") {
      this.readOnly = false;
      return { rowCount: 0, rows: [] };
    }
    const writing = /^(INSERT|UPDATE|DELETE)/.test(sql.trimStart());
    if (writing && this.readOnly) throw new Error("write in read-only transaction");
    if (writing) this.writes++;
    const userId = String(values[0]);
    if (sql.includes("FROM telegram_roster_entries")) {
      const row = this.roster.get(userId);
      return { rowCount: row ? 1 : 0,
        rows: row ? [{ participant_id: row.participantId }] : [] };
    }
    if (sql.includes("FROM external_identities")) {
      const matches = sql.includes("SELECT DISTINCT")
        ? this.identities.filter((item) => item.userId === userId)
        : this.identities.filter((item) => item.userId === userId ||
          item.subject === String(values[1]) ||
          (values[2] && item.participantId === values[2]));
      return { rowCount: matches.length, rows: matches.map((item) => ({
        id: item.id, participant_id: item.participantId,
        provider_subject: item.subject, external_user_id: item.userId,
      })) };
    }
    if (sql.includes("INSERT INTO telegram_roster_entries")) {
      const incoming = String(values[4]);
      const previous = this.roster.get(userId);
      if (!previous || previous.observedAt <= incoming) {
        this.roster.set(userId, { participantId: previous?.participantId ?? null,
          observedAt: incoming });
      }
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("UPDATE telegram_roster_entries")) {
      const row = this.roster.get(userId);
      if (row && !row.participantId) row.participantId = String(values[1]);
    }
    if (sql.includes("INSERT INTO participants(")) {
      const id = `30000000-0000-4000-8000-${String(this.nextParticipant++).padStart(12, "0")}`;
      this.participants.add(id);
      return { rowCount: 1, rows: [{ id }] };
    }
    if (sql.includes("INSERT INTO external_identities(")) {
      this.identities.push({ id: `identity-${this.identities.length + 1}`,
        participantId: String(values[0]), subject: String(values[1]), userId: String(values[2]) });
    }
    if (sql.includes("UPDATE external_identities")) {
      const row = this.identities.find((item) => item.id === values[0]);
      if (row) row.userId = String(values[1]);
    }
    if (sql.includes("INSERT INTO participant_forum_onboarding")) {
      const id = String(values[0]);
      if (this.onboarding.has(id)) return { rowCount: 0, rows: [] };
      this.onboarding.set(id, { status: "joined", observedAt: (values[1] as Date).toISOString() });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("FROM participant_forum_onboarding")) {
      const row = this.onboarding.get(userId);
      return { rowCount: row ? 1 : 0, rows: row
        ? [{ forum_status: row.status, observed_at: row.observedAt }] : [] };
    }
    if (sql.includes("UPDATE participant_forum_onboarding")) {
      this.onboarding.set(userId, { status: "joined", observedAt: (values[1] as Date).toISOString() });
    }
    if (sql.includes("INSERT INTO events")) {
      this.events.push(sql.includes("participant.created")
        ? "participant.created" : "onboarding.forum_joined");
    }
    return { rowCount: 1, rows: [] };
  }
}

describe("one-shot forum roster import", () => {
  it("previews humans, bots, existing identities and new Participants without writes", async () => {
    const db = new FakeDatabase();
    db.identities.push({ id: "identity-existing", participantId: existingParticipant,
      userId: "42", subject: "oidc-subject" });
    const result = await previewTelegramForumRosterImport(db, snapshot(), forumChatId);
    expect(result).toMatchObject({ accountsFound: 3, botsSkipped: 1, peopleFound: 2,
      existingParticipants: 1, newParticipants: 1, conflicts: 0 });
    expect(db.writes).toBe(0);
  });

  it("creates a minimal Participant once and records forum_joined once", async () => {
    const db = new FakeDatabase();
    db.identities.push({ id: "identity-existing", participantId: existingParticipant,
      userId: "42", subject: "oidc-subject" });
    const first = await applyTelegramForumRosterImport(db, snapshot(), forumChatId, now);
    const second = await applyTelegramForumRosterImport(db, snapshot(), forumChatId, now);
    expect(first).toMatchObject({ participantsCreated: 1, forumJoinedRecorded: 2 });
    expect(second).toMatchObject({ participantsCreated: 0, forumJoinedRecorded: 0 });
    expect(db.identities).toHaveLength(2);
    expect(db.roster.has("44")).toBe(false);
    expect(db.events).toEqual([
      "onboarding.forum_joined", "participant.created", "onboarding.forum_joined",
    ]);
  });

  it("preserves a newer absent observation and newer roster data", async () => {
    const db = new FakeDatabase();
    db.identities.push({ id: "identity-existing", participantId: existingParticipant,
      userId: "42", subject: "oidc-subject" });
    db.onboarding.set(existingParticipant, { status: "absent",
      observedAt: "2026-10-02T09:30:00.000Z" });
    db.roster.set("42", { participantId: existingParticipant,
      observedAt: "2026-10-02T09:30:00.000Z" });
    await applyTelegramForumRosterImport(db, snapshot([{ id: "42" }]), forumChatId, now);
    expect(db.onboarding.get(existingParticipant)).toEqual({ status: "absent",
      observedAt: "2026-10-02T09:30:00.000Z" });
    expect(db.roster.get("42")?.observedAt).toBe("2026-10-02T09:30:00.000Z");
    expect(db.events).toEqual([]);
  });

  it("counts conflicts and refuses apply", async () => {
    const db = new FakeDatabase();
    db.roster.set("42", { participantId: existingParticipant, observedAt });
    db.identities.push({ id: "identity-conflict", participantId: otherParticipant,
      userId: "42", subject: "oidc-subject" });
    const input = snapshot([{ id: "42" }]);
    expect(await previewTelegramForumRosterImport(db, input, forumChatId))
      .toMatchObject({ peopleFound: 1, conflicts: 1, newParticipants: 0 });
    expect(db.writes).toBe(0);
    await expect(applyTelegramForumRosterImport(db, input, forumChatId, now))
      .rejects.toThrow("identity conflicts");
    expect(db.writes).toBe(0);
  });

  it("detects two Telegram IDs pointing to one Participant", async () => {
    const db = new FakeDatabase();
    db.roster.set("42", { participantId: existingParticipant, observedAt });
    db.roster.set("43", { participantId: existingParticipant, observedAt });
    const result = await previewTelegramForumRosterImport(db,
      snapshot([{ id: "42" }, { id: "43" }]), forumChatId);
    expect(result).toMatchObject({ peopleFound: 2, existingParticipants: 0,
      newParticipants: 0, conflicts: 2 });
    expect(db.writes).toBe(0);
  });

  it("rejects the wrong forum and an outdated apply snapshot", async () => {
    const db = new FakeDatabase();
    await expect(previewTelegramForumRosterImport(db, snapshot(), "-1009999999999"))
      .rejects.toThrow("different Telegram forum");
    await expect(applyTelegramForumRosterImport(db, snapshot(), forumChatId,
      new Date("2026-10-04T10:00:00.000Z"))).rejects.toThrow("last 24 hours");
    expect(db.writes).toBe(0);
  });
});
