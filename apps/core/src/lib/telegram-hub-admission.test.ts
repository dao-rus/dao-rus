import { describe, expect, it, vi } from "vitest";
import { DAO_CODE_CLAUSES } from "./dao-code";
import {
  handleHubAdmissionCallback,
  handleHubStart,
  processHubAdmissionDecisions,
  receiveHubJoinRequest,
  type HubAdmissionDatabase,
} from "./telegram-hub-admission";

const participantId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
function database(options: { identity?: boolean; failCreate?: boolean } = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const rows: Record<string, unknown>[] = [];
  const updateIds = new Set<string>();
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes("FROM telegram_hubs")) return { rowCount: 1, rows: [{ id: "test_hub", chat_id: "-1007", response_timeout: "24:00:00" }] };
    if (sql.includes("INSERT INTO telegram_hub_join_requests")) {
      const updateId = String(values?.[2]);
      if (updateIds.has(updateId)) return { rowCount: 0, rows: [] };
      updateIds.add(updateId);
      return { rowCount: 1, rows: [{ id: requestId }] };
    }
    if (sql.includes("FROM telegram_hub_join_requests r")) return { rowCount: 1, rows: [{ id: requestId, hub_id: "test_hub", chat_id: "-1007", telegram_user_id: "42", status: "pending", expires_at: new Date(Date.now() + 60_000).toISOString() }] };
    if (sql.includes("FROM telegram_roster_entries")) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM external_identities")) return options.identity
      ? { rowCount: 1, rows: [{ id: "identity", participant_id: participantId, provider_subject: "oidc:existing", external_user_id: "42" }] }
      : { rowCount: 0, rows: [] };
    if (sql.includes("INSERT INTO participants(")) {
      if (options.failCreate) throw new Error("database unavailable");
      return { rowCount: 1, rows: [{ id: participantId }] };
    }
    if (sql.includes("INSERT INTO telegram_hub_join_requests(hub_id")) return { rowCount: 1, rows: [{ id: requestId }] };
    if (sql.includes("UPDATE telegram_hub_join_requests SET status='approval_pending'")) rows.push({ status: "approval_pending" });
    return { rowCount: 1, rows: [] };
  });
  const client = { query, release: vi.fn() };
  const db: HubAdmissionDatabase = { query, connect: async () => client };
  return { db, calls, query };
}
const update = { update_id: 99, chat_join_request: {
  chat: { id: -1007 }, from: { id: 42 }, user_chat_id: 42, date: Math.floor(Date.now() / 1000),
} };

describe("Telegram hub admission", () => {
  it("offers the exact canonical Code and creates a callback-bound pending request", async () => {
    const { db, calls } = database();
    const bot = vi.fn(async (..._args: [string, Record<string, unknown>]) => ({ ok: true }));
    expect(await receiveHubJoinRequest(update, db, bot)).toBe("offered");
    const params = bot.mock.calls[0][1] as Record<string, unknown>;
    expect(params.chat_id).toBe(42);
    expect(params.text).toContain(DAO_CODE_CLAUSES.map((clause, index) => `${index + 1}. ${clause.text}`).join("\n\n"));
    expect(params.text).toContain("не создаёт членства в ДАО");
    expect(calls.some(({ sql }) => sql.includes("INSERT INTO telegram_hub_join_requests"))).toBe(true);
    expect(await receiveHubJoinRequest(update, db, bot)).toBe("duplicate");
    expect(bot).toHaveBeenCalledTimes(1);
  });

  it("stores acceptance before approval and preserves an existing Core identity", async () => {
    const { db, calls } = database({ identity: true });
    const bot = vi.fn(async (method: string, _params: Record<string, unknown>) => ({ ok: true, result: method === "approveChatJoinRequest" ? true : undefined }));
    const callback = { callback_query: { id: "cb", from: { id: 42 }, data: `ha:yes:${requestId}` } };
    expect(await handleHubAdmissionCallback(callback, db, bot)).toBe("handled");
    expect(calls.some(({ sql }) => sql.includes("INSERT INTO telegram_hub_memberships"))).toBe(true);
    expect(calls.some(({ sql }) => sql.includes("INSERT INTO participants("))).toBe(false);
    expect(calls.some(({ sql }) => sql.includes("UPDATE participants"))).toBe(false);
    expect(bot.mock.calls.map(([method]) => method)).toEqual(["approveChatJoinRequest", "answerCallbackQuery"]);
  });

  it("never approves when Core persistence fails", async () => {
    const { db } = database({ failCreate: true });
    const bot = vi.fn(async (..._args: [string, Record<string, unknown>]) => ({ ok: true }));
    await expect(handleHubAdmissionCallback({ callback_query: {
      id: "cb", from: { id: 42 }, data: `ha:yes:${requestId}`,
    } }, db, bot)).rejects.toThrow("database unavailable");
    expect(bot).not.toHaveBeenCalled();
  });

  it("tries a normal bot DM when Telegram rejects user_chat_id", async () => {
    const { db } = database();
    const bot = vi.fn(async (_method: string, _params: Record<string, unknown>, call = 0) => ({ ok: call > 0 }));
    let calls = 0;
    const transport = (method: string, params: Record<string, unknown>) => bot(method, params, calls++);
    await receiveHubJoinRequest({ ...update, chat_join_request: { ...update.chat_join_request, user_chat_id: 4200 } }, db, transport);
    expect(bot.mock.calls.map(([, params]) => params.chat_id)).toEqual([4200, 42]);
  });

  it("restores the pending prompt through a normal direct bot start", async () => {
    const db = database();
    db.query.mockImplementation(async (sql: string) => sql.includes("FROM telegram_hub_join_requests r JOIN telegram_hubs")
      ? { rowCount: 1, rows: [{ id: requestId, chat_id: "-1007" }] }
      : { rowCount: 0, rows: [] });
    const bot = vi.fn(async (_method: string, _params: Record<string, unknown>) => ({ ok: true }));
    expect(await handleHubStart("42", db.db, bot)).toBe(true);
    expect(bot.mock.calls[0][0]).toBe("sendMessage");
    expect(bot.mock.calls[0][1].chat_id).toBe(42);
    expect(bot.mock.calls[0][1].reply_markup).toBeDefined();
  });

  it("declines a refusal and reconciles an expired request through the worker", async () => {
    const { db, query } = database();
    query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("UPDATE telegram_hub_join_requests SET status='refused'")) return { rowCount: 1, rows: [] };
      if (sql.includes("UPDATE telegram_hub_join_requests SET status='expired'")) return { rowCount: 1, rows: [{ id: requestId }] };
      if (sql.includes("WHERE r.status IN ('approval_pending','refused','expired')")) return { rowCount: 1, rows: [{ id: requestId, status: "expired", chat_id: "-1007", telegram_user_id: "42" }] };
      if (sql.includes("UPDATE telegram_hub_join_requests SET status='approval_pending'")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM telegram_hub_join_requests r")) return { rowCount: 1, rows: [{ id: requestId, hub_id: "test_hub", chat_id: "-1007", telegram_user_id: "42", status: "pending", expires_at: new Date(Date.now() + 60_000).toISOString() }] };
      return { rowCount: 1, rows: [] };
    });
    const bot = vi.fn(async (..._args: [string, Record<string, unknown>]) => ({ ok: true }));
    await handleHubAdmissionCallback({ callback_query: {
      id: "cb", from: { id: 42 }, data: `ha:no:${requestId}`,
    } }, db, bot);
    expect(bot.mock.calls[0][0]).toBe("declineChatJoinRequest");
    bot.mockClear();
    await processHubAdmissionDecisions(db, bot);
    expect(bot.mock.calls[0][0]).toBe("declineChatJoinRequest");
  });

  it("ignores callbacks from a different Telegram user", async () => {
    const { db } = database();
    const bot = vi.fn(async (..._args: [string, Record<string, unknown>]) => ({ ok: true }));
    await handleHubAdmissionCallback({ callback_query: {
      id: "cb", from: { id: 43 }, data: `ha:yes:${requestId}`,
    } }, db, bot);
    expect(bot.mock.calls.map(([method]) => method)).toEqual(["answerCallbackQuery"]);
  });
});
