import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  telegramBotToken: vi.fn(() => "123:dev-token"),
  telegramReceptionConfig: vi.fn(() => { throw new Error("Reception bot must not be used"); }),
  appBaseUrl: vi.fn(() => "https://core.daorus.org"),
}));
vi.mock("./config", () => config);

import {
  claimPendingDelivery,
  expireStaleDeliveries,
  processNextNotificationDelivery,
  sendTelegramDelivery,
  telegramActionUrl,
  type DeliveryStatus,
} from "./notification-delivery";

type Row = {
  id: string;
  participantId: string;
  text: string;
  actionUrl: string | null;
  externalUserId: string | null;
  identityConflict: boolean;
  status: "pending" | "processing" | DeliveryStatus;
  attempted: boolean;
  messageId: string | null;
  errorCode: string | null;
};

function database(options: Partial<Row> = {}) {
  const row: Row = { id: "delivery-1", participantId: "participant-1", text: "Техническое сообщение",
    actionUrl: null, externalUserId: "123456", identityConflict: false, status: "pending", attempted: false,
    messageId: null, errorCode: null, ...options };
  let transactionOpen = 0;
  let claimCount = 0;
  const sql: string[] = [];
  const query = vi.fn(async (statement: string, values?: unknown[]) => {
    sql.push(statement);
    if (statement === "BEGIN") { transactionOpen++; return { rowCount: null, rows: [] }; }
    if (statement === "COMMIT" || statement === "ROLLBACK") { transactionOpen--; return { rowCount: null, rows: [] }; }
    if (statement.includes("WITH candidate AS")) {
      if (row.status !== "pending") return { rowCount: 0, rows: [] };
      row.status = "processing";
      claimCount++;
      return { rowCount: 1, rows: [{ id: row.id, participant_id: row.participantId,
        text: row.text, action_url: row.actionUrl }] };
    }
    if (statement.includes("SELECT identity.external_user_id")) {
      return row.externalUserId === null ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [{ external_user_id: row.externalUserId, identity_conflict: row.identityConflict }] };
    }
    if (statement.includes("SET attempted_at")) {
      if (row.status !== "processing" || row.attempted) return { rowCount: 0, rows: [] };
      row.attempted = true;
      return { rowCount: 1, rows: [{ id: row.id }] };
    }
    if (statement.includes("SET status = 'unknown'")) {
      if (row.status !== "processing") return { rowCount: 0, rows: [] };
      row.status = "unknown"; row.errorCode = "claim_expired";
      return { rowCount: 1, rows: [{ id: row.id }] };
    }
    if (statement.includes("SET status = $2")) {
      if (row.status !== "processing") return { rowCount: 0, rows: [] };
      row.status = values![1] as DeliveryStatus;
      row.messageId = values![2] as string | null;
      row.errorCode = values![3] as string | null;
      return { rowCount: 1, rows: [{ id: row.id }] };
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  });
  const client = { query, release: vi.fn() };
  return { row, sql, query, connect: vi.fn(async () => client),
    get transactionOpen() { return transactionOpen; }, get claimCount() { return claimCount; } };
}

function response(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

function requestWith(status: number, body: unknown) {
  return vi.fn(async () => response(status, body)) as unknown as typeof fetch;
}

describe("notification delivery worker", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("atomically claims one pending delivery across concurrent workers and commits processing", async () => {
    const db = database();
    const [first, second] = await Promise.all([claimPendingDelivery(db), claimPendingDelivery(db)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(db.claimCount).toBe(1);
    expect(db.row.status).toBe("processing");
    expect(db.transactionOpen).toBe(0);
    expect(db.sql.find((statement) => statement.includes("WITH candidate AS"))).toContain("FOR UPDATE OF delivery SKIP LOCKED");
  });

  it("sends after commit through the Dev bot and stores message_id", async () => {
    const db = database();
    const request = requestWith(200, { ok: true, result: { message_id: 37 } });
    const guardedRequestMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      expect(db.transactionOpen).toBe(0);
      return request(...args);
    });
    const guardedRequest = guardedRequestMock as unknown as typeof fetch;
    expect(await processNextNotificationDelivery(db, true, guardedRequest))
      .toEqual({ id: "delivery-1", status: "sent", errorCode: undefined });
    expect(db.row).toMatchObject({ status: "sent", attempted: true, messageId: "37", errorCode: null });
    expect(config.telegramBotToken).toHaveBeenCalledOnce();
    expect(config.telegramReceptionConfig).not.toHaveBeenCalled();
    expect(guardedRequestMock).toHaveBeenCalledOnce();
    expect(guardedRequestMock.mock.calls[0][0]).toBe("https://api.telegram.org/bot123:dev-token/sendMessage");
  });

  it("classifies 403 as blocked", async () => {
    const db = database();
    const result = await processNextNotificationDelivery(db, true, requestWith(403, { ok: false, error_code: 403 }));
    expect(result?.status).toBe("blocked");
    expect(db.row.errorCode).toBe("telegram_403");
  });

  it("classifies a deterministic client error as failed, not blocked", async () => {
    const db = database();
    const result = await processNextNotificationDelivery(db, true, requestWith(400, { ok: false, error_code: 400 }));
    expect(result?.status).toBe("failed");
    expect(db.row.errorCode).toBe("telegram_400");
  });

  it.each(["TimeoutError", "TypeError"])("classifies %s as unknown without retry", async (errorName) => {
    const db = database();
    const request = vi.fn(async () => { const error = new Error("private transport detail"); error.name = errorName; throw error; }) as unknown as typeof fetch;
    const result = await processNextNotificationDelivery(db, true, request);
    expect(result?.status).toBe("unknown");
    expect(db.row.errorCode).toBe(errorName === "TimeoutError" ? "telegram_timeout" : "telegram_network_error");
    expect(request).toHaveBeenCalledOnce();
    expect((await processNextNotificationDelivery(db, true, request))).toBeNull();
    expect(request).toHaveBeenCalledOnce();
  });

  it("classifies ambiguous 5xx and malformed responses as unknown", async () => {
    expect((await sendTelegramDelivery("token", 123, "text", null, requestWith(502, { ok: false }))).status).toBe("unknown");
    expect((await sendTelegramDelivery("token", 123, "text", null, requestWith(200, { ok: true }))).status).toBe("unknown");
    const unreadable = vi.fn(async () => ({ status: 200, ok: true, json: async () => { throw new Error("unreadable"); } } as unknown as Response)) as unknown as typeof fetch;
    expect((await sendTelegramDelivery("token", 123, "text", null, unreadable)).status).toBe("unknown");
  });

  it("expires stale processing to unknown without any sendMessage", async () => {
    const db = database({ status: "processing" });
    const request = requestWith(200, { ok: true, result: { message_id: 1 } });
    expect(await expireStaleDeliveries(db)).toEqual(["delivery-1"]);
    expect(db.row).toMatchObject({ status: "unknown", errorCode: "claim_expired" });
    expect(db.sql[0]).toContain("interval '10 minutes'");
    expect(await processNextNotificationDelivery(db, true, request)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["sent", "blocked", "failed", "unknown"] as const)("never re-sends terminal %s", async (status) => {
    const db = database({ status });
    const request = requestWith(200, { ok: true, result: { message_id: 1 } });
    expect(await processNextNotificationDelivery(db, true, request)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([null, "not-numeric", "9007199254740992"])("fails without a usable Telegram identity (%s)", async (externalUserId) => {
    const db = database({ externalUserId });
    const request = requestWith(200, { ok: true, result: { message_id: 1 } });
    expect((await processNextNotificationDelivery(db, true, request))?.status).toBe("failed");
    expect(db.row.errorCode).toBe("invalid_telegram_identity");
    expect(db.row.attempted).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("does not send when the Telegram identity conflicts with another binding", async () => {
    const db = database({ identityConflict: true });
    const request = requestWith(200, { ok: true, result: { message_id: 1 } });
    expect((await processNextNotificationDelivery(db, true, request))?.status).toBe("failed");
    expect(db.row.errorCode).toBe("invalid_telegram_identity");
    expect(request).not.toHaveBeenCalled();
    expect(db.sql.find((statement) => statement.includes("SELECT identity.external_user_id"))).toContain("identity_conflict");
  });

  it("does not claim pending while disabled", async () => {
    const db = database();
    const request = requestWith(200, { ok: true, result: { message_id: 1 } });
    expect(await processNextNotificationDelivery(db, false, request)).toBeNull();
    expect(db.connect).not.toHaveBeenCalled();
    expect(db.row.status).toBe("pending");
    expect(request).not.toHaveBeenCalled();
  });

  it("adds a safe absolute action link as an inline button", async () => {
    expect(telegramActionUrl("/profile", "https://core.daorus.org")).toBe("https://core.daorus.org/profile");
    expect(telegramActionUrl("https://example.org/event", "https://core.daorus.org")).toBe("https://example.org/event");
    const db = database({ actionUrl: "/profile" });
    const request = requestWith(200, { ok: true, result: { message_id: 1 } });
    await processNextNotificationDelivery(db, true, request);
    const body = JSON.parse((request as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toEqual({ chat_id: 123456, text: "Техническое сообщение",
      reply_markup: { inline_keyboard: [[{ text: "Открыть", url: "https://core.daorus.org/profile" }]] } });
  });

  it("fails an unsafe stored action URL without calling Telegram", async () => {
    const db = database({ actionUrl: "javascript:alert(1)" });
    const request = requestWith(200, { ok: true, result: { message_id: 1 } });
    expect((await processNextNotificationDelivery(db, true, request))?.status).toBe("failed");
    expect(db.row.errorCode).toBe("invalid_action_url");
    expect(request).not.toHaveBeenCalled();
  });
});
