import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForumAndInvite,
  observeForumMemberUpdate,
  observeForumMembership,
  receptionBot,
  type ForumBot,
  type ForumDatabase,
} from "./telegram-forum-onboarding";

const config = vi.hoisted(() => ({ invitesEnabled: true }));

vi.mock("./config", () => ({
  telegramReceptionConfig: () => ({
    token: "reception-token",
    forumChatId: "-1001234567890",
    forumInviteUrl: "https://t.me/+example",
    guardianInvitesEnabled: config.invitesEnabled,
  }),
}));

const participantId = "10000000-0000-4000-8000-000000000001";

function fakeDatabase(hasIdentity = true, hasApplication = false) {
  const state: {
    status?: string;
    observedAt?: Date;
    attemptedAt?: Date;
    blockedAt?: Date;
    sentAt?: Date;
  } = {};
  const events: string[] = [];
  const eventPayloads: unknown[] = [];
  const history: Array<Record<string, unknown>> = [];
  let identityParticipantId: string | null = hasIdentity ? participantId : null;
  let createdParticipants = 0;
  let createdIdentities = 0;
  const client = {
    async query(sql: string, values?: unknown[]) {
      if (sql.includes("FROM reception_applications")) return { rowCount: hasApplication ? 1 : 0, rows: hasApplication ? [{ id: "application" }] : [] };
      if (sql.includes("SELECT event_type, payload FROM events")) return { rowCount: history.length, rows: history };
      if (sql.includes("FROM telegram_roster_entries")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM external_identities")) return identityParticipantId
        ? { rowCount: 1, rows: [{ id: "identity-id", participant_id: identityParticipantId,
          external_user_id: "42" }] }
        : { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO participants(")) {
        createdParticipants++;
        return { rowCount: 1, rows: [{ id: participantId }] };
      }
      if (sql.includes("INSERT INTO external_identities(")) {
        createdIdentities++;
        identityParticipantId = String(values?.[0]);
      }
      if (sql.includes("INSERT INTO participant_forum_onboarding")) {
        if (state.status) return { rowCount: 0, rows: [] };
        state.status = String(values?.[1]);
        state.observedAt = values?.[2] as Date;
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("FROM participant_forum_onboarding")) return {
        rowCount: 1,
        rows: [{ forum_status: state.status, observed_at: state.observedAt,
          invitation_attempted_at: state.attemptedAt, invitation_blocked_at: state.blockedAt }],
      };
      if (sql.includes("SET forum_status")) {
        state.status = String(values?.[1]);
        state.observedAt = values?.[2] as Date;
      }
      if (sql.includes("SET invitation_attempted_at")) {
        state.attemptedAt = new Date();
        state.blockedAt = undefined;
      }
      if (sql.includes("SET invitation_sent_at")) state.sentAt = new Date();
      if (sql.includes("SET invitation_blocked_at")) state.blockedAt = new Date();
      if (sql.includes("INSERT INTO events")) {
        events.push(sql.includes("'participant.created'") ? "participant.created" : String(values?.[0]));
        if (values?.[2]) eventPayloads.push(JSON.parse(String(values[2])));
        if (values?.[2]) history.push({ event_type: String(values[0]), payload: JSON.parse(String(values[2])) });
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  const database: ForumDatabase = {
    connect: async () => client,
    query: client.query,
  };
  return { database, state, events, eventPayloads,
    counts: () => ({ participants: createdParticipants, identities: createdIdentities }) };
}

describe("forum onboarding", () => {
  it.each(["start", "login"] as const)("never auto-invites an applicant through %s", async source => {
    const { database, state } = fakeDatabase(true, true);
    const bot: ForumBot = { getMember: vi.fn(async () => false), sendInvite: vi.fn(async () => "sent" as const) };
    await checkForumAndInvite("42", source, database, bot);
    expect(bot.sendInvite).not.toHaveBeenCalled(); expect(state.attemptedAt).toBeUndefined();
  });
  beforeEach(() => { config.invitesEnabled = true; });

  it("records incomplete onboarding and claims only one invitation", async () => {
    const { database, state, events } = fakeDatabase();
    const first = await observeForumMembership(database, "42", false, new Date("2026-10-01T10:00:00Z"), "login");
    const second = await observeForumMembership(database, "42", false, new Date("2026-10-01T10:01:00Z"), "login");
    expect(first?.shouldInvite).toBe(true);
    expect(second?.shouldInvite).toBe(false);
    expect(state.status).toBe("absent");
    expect(events).toEqual(["onboarding.forum_incomplete"]);
  });

  it("records a join and ignores an older absent observation", async () => {
    const { database, state, events } = fakeDatabase();
    await observeForumMembership(database, "42", false, new Date("2026-10-01T10:00:00Z"), null);
    await observeForumMembership(database, "42", true, new Date("2026-10-01T10:02:00Z"), null);
    const stale = await observeForumMembership(database, "42", false, new Date("2026-10-01T10:01:00Z"), "login");
    expect(state.status).toBe("joined");
    expect(stale?.shouldInvite).toBe(false);
    expect(events).toEqual(["onboarding.forum_incomplete", "onboarding.forum_joined"]);
  });

  it("sends once after checking membership and does not repeat after a join", async () => {
    const { database, state } = fakeDatabase();
    let joined = false;
    const bot: ForumBot = {
      getMember: vi.fn(async () => joined),
      sendInvite: vi.fn(async () => "sent" as const),
    };
    await checkForumAndInvite("42", "login", database, bot);
    await checkForumAndInvite("42", "login", database, bot);
    joined = true;
    await checkForumAndInvite("42", "login", database, bot);
    expect(bot.sendInvite).toHaveBeenCalledTimes(1);
    expect(state.sentAt).toBeInstanceOf(Date);
    expect(state.status).toBe("joined");
  });

  it("retries a blocked private message only after Reception /start", async () => {
    const { database } = fakeDatabase();
    let sends = 0;
    const bot: ForumBot = {
      getMember: vi.fn(async () => false),
      sendInvite: vi.fn(async () => (++sends === 1 ? "blocked" : "sent") as "blocked" | "sent"),
    };
    await checkForumAndInvite("42", "login", database, bot);
    await checkForumAndInvite("42", "login", database, bot);
    expect(bot.sendInvite).toHaveBeenCalledTimes(1);
    await checkForumAndInvite("42", "start", database, bot);
    expect(bot.sendInvite).toHaveBeenCalledTimes(2);
  });

  it("does not query Telegram for an unknown Core identity", async () => {
    const { database } = fakeDatabase(false);
    const bot: ForumBot = {
      getMember: vi.fn(async () => false),
      sendInvite: vi.fn(async () => "sent" as const),
    };
    await checkForumAndInvite("42", "start", database, bot);
    expect(bot.getMember).not.toHaveBeenCalled();
  });

  it("observes membership but never invites when the guardian flag is off", async () => {
    config.invitesEnabled = false;
    const { database, state, events } = fakeDatabase();
    const bot: ForumBot = {
      getMember: vi.fn(async () => false),
      sendInvite: vi.fn(async () => "sent" as const),
    };
    await checkForumAndInvite("42", "login", database, bot);
    await checkForumAndInvite("42", "start", database, bot);
    expect(state.status).toBe("absent");
    expect(state.attemptedAt).toBeUndefined();
    expect(events).toEqual(["onboarding.forum_incomplete"]);
    expect(bot.sendInvite).not.toHaveBeenCalled();
  });

  it("recognizes a join update without storing unknown Telegram fields", async () => {
    const { database, state, eventPayloads, counts } = fakeDatabase();
    const result = await observeForumMemberUpdate({ update_id: 901, chat_member: {
      chat: { id: -1001234567890 }, date: 1790858400,
      old_chat_member: { status: "left" },
      new_chat_member: { status: "member", user: { id: 42, first_name: "Private" } },
    } }, database);
    expect(result).toBe("observed");
    expect(state.status).toBe("joined");
    expect(eventPayloads[0]).toMatchObject({ source: "chat_member", telegram_update_id: 901 });
    expect(counts()).toEqual({ participants: 0, identities: 0 });
  });

  it("creates a minimal Participant only for a confirmed forum join and reuses it on repeat", async () => {
    const { database, state, events, counts } = fakeDatabase(false);
    const update = { update_id: 901, chat_member: {
      chat: { id: -1001234567890 }, date: 1790858400,
      old_chat_member: { status: "left" },
      new_chat_member: { status: "member", user: { id: 42, first_name: "Private" } },
    } };
    expect(await observeForumMemberUpdate(update, database)).toBe("observed");
    expect(await observeForumMemberUpdate(update, database)).toBe("observed");
    expect(counts()).toEqual({ participants: 1, identities: 1 });
    expect(state.status).toBe("joined");
    expect(events).toEqual(["participant.created", "forum.joined"]);
  });

  it("remembers the name a person joined the forum under, and nothing for a leave", async () => {
    const { database } = fakeDatabase(false);
    const query = vi.spyOn(database, "query");
    const update = (id: number, old: string, status: string) => ({ update_id: id, chat_member: {
      chat: { id: -1001234567890 }, date: 1790858400 + id, old_chat_member: { status: old },
      new_chat_member: { status, user: { id: 42, first_name: " Анна ", last_name: "Иванова", username: "anna" } } } });
    await observeForumMemberUpdate(update(1, "left", "member"), database);
    const identity = query.mock.calls.filter(([sql]) => String(sql).includes("UPDATE external_identities identity"));
    expect(identity).toHaveLength(1);
    expect(identity[0][1]).toEqual(["42", "anna", "Анна", "Иванова"]);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("SET display_name"))).toHaveLength(1);
    await observeForumMemberUpdate(update(2, "member", "left"), database);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("SET display_name"))).toHaveLength(1);
  });

  it("does not create a Participant for a left event", async () => {
    const { database, counts } = fakeDatabase(false);
    const result = await observeForumMemberUpdate({ update_id: 902, chat_member: {
      chat: { id: -1001234567890 }, date: 1790858400,
      old_chat_member: { status: "member" },
      new_chat_member: { status: "left", user: { id: 42 } },
    } }, database);
    expect(result).toBe("ignored");
    expect(counts()).toEqual({ participants: 0, identities: 0 });
  });

  it("sets an existing Participant to absent on a left event", async () => {
    const { database, state, events, counts } = fakeDatabase();
    const result = await observeForumMemberUpdate({ update_id: 903, chat_member: {
      chat: { id: -1001234567890 }, date: 1790858400,
      old_chat_member: { status: "member" },
      new_chat_member: { status: "left", user: { id: 42 } },
    } }, database);
    expect(result).toBe("observed");
    expect(state.status).toBe("absent");
    expect(events).toEqual(["forum.left"]);
    expect(counts()).toEqual({ participants: 0, identities: 0 });
  });

  it("preserves joined → left → rejoined → removed history and ignores duplicate updates", async () => {
    const { database, events, state, eventPayloads } = fakeDatabase();
    const update = (id: number, old: string, status: string) => ({ update_id: id, chat_member: {
      chat: { id: -1001234567890 }, date: 1790858400 + id,
      old_chat_member: { status: old }, new_chat_member: { status, user: { id: 42, first_name: "Private" } },
    } });
    await observeForumMemberUpdate(update(1, "left", "member"), database);
    await observeForumMemberUpdate(update(2, "member", "left"), database);
    await observeForumMemberUpdate(update(3, "left", "member"), database);
    await observeForumMemberUpdate(update(4, "member", "kicked"), database);
    await observeForumMemberUpdate(update(4, "member", "kicked"), database);
    expect(events).toEqual(["forum.joined", "forum.left", "forum.rejoined", "forum.removed"]);
    expect(state.status).toBe("absent");
    expect(eventPayloads).toHaveLength(4);
    expect(eventPayloads[3]).toEqual({ source: "chat_member", observed_at: new Date(1790858404000).toISOString(), telegram_update_id: 4 });
    expect(events).not.toContain("membership.excluded");
  });

  it("generic checks do not invent departure reasons and a later explicit update still records history", async () => {
    const { database, events } = fakeDatabase();
    await observeForumMembership(database, "42", true, new Date("2026-10-01T10:00:00Z"), null);
    await observeForumMembership(database, "42", false, new Date("2026-10-01T10:02:00Z"), null);
    expect(events).toEqual(["onboarding.forum_joined", "onboarding.forum_incomplete"]);
    await observeForumMemberUpdate({ update_id: 20, chat_member: {
      chat: { id: -1001234567890 }, date: Date.parse("2026-10-01T10:01:00Z") / 1000,
      old_chat_member: { status: "member" }, new_chat_member: { status: "left", user: { id: 42 } },
    } }, database);
    expect(events.at(-1)).toBe("forum.left");
  });
});

describe("Reception Bot API", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("treats restricted members according to is_member and fails closed on API errors", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({ json: async () => ({ ok: true, result: { status: "restricted", is_member: true } }) } as Response);
    expect(await receptionBot("token").getMember("-1001", "42")).toBe(true);
    fetchMock.mockResolvedValueOnce({ json: async () => ({ ok: false, error_code: 400 }) } as Response);
    await expect(receptionBot("token").getMember("-1001", "42")).rejects.toThrow();
  });
});
