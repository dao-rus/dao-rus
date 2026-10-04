import { describe, expect, it, vi } from "vitest";
import {
  countUnreadNotificationsWithDatabase,
  createNotificationWithDatabase,
  listNotificationsWithDatabase,
  markNotificationReadWithDatabase,
  NotificationValidationError,
} from "./notifications";

const base = { participantId: "recipient", notificationType: "technical", text: "Сообщение", sourceType: "system" as const };

function database(failDelivery = false) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (failDelivery && sql.includes("INSERT INTO notification_deliveries")) throw new Error("delivery failed");
      return { rowCount: 1, rows: sql.includes("INSERT INTO notifications") ? [{ id: "notification-id" }] : [] };
    }),
    release: vi.fn(),
  };
  return { client, queries, connect: vi.fn(async () => client) };
}

describe("Core notifications", () => {
  it("counts only unread notifications belonging to the recipient", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ unread_count: 2 }] }) };
    expect(await countUnreadNotificationsWithDatabase(db, "recipient")).toBe(2);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("participant_id = $1::uuid AND read_at IS NULL"),
      ["recipient"],
    );
    db.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ unread_count: 0 }] });
    expect(await countUnreadNotificationsWithDatabase(db, "recipient")).toBe(0);
  });
  it("creates an internal Notification without a delivery or Telegram API call", async () => {
    const db = database();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      expect(await createNotificationWithDatabase(db, base)).toBe("notification-id");
      expect(db.queries.map(({ sql }) => sql.trim().split(/\s+/u)[0])).toEqual(["BEGIN", "INSERT", "COMMIT"]);
      expect(db.queries.some(({ sql }) => sql.includes("notification_deliveries"))).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(db.client.release).toHaveBeenCalledOnce();
    } finally { fetchSpy.mockRestore(); }
  });

  it("creates Notification and pending Telegram delivery in one transaction", async () => {
    const db = database();
    await createNotificationWithDatabase(db, { ...base, queueTelegram: true });
    expect(db.queries.map(({ sql }) => sql.trim().split(/\s+/u)[0])).toEqual(["BEGIN", "INSERT", "INSERT", "COMMIT"]);
    expect(db.queries[2].sql).toContain("'telegram', 'pending'");
    expect(db.queries[2].values).toEqual(["notification-id"]);
  });

  it("stores a custom action label with the Core notification", async () => {
    const db = database();
    await createNotificationWithDatabase(db, { ...base, actionUrl: "/profile", actionLabel: "Добавить интересы" });
    expect(db.queries[1].sql).toContain("action_label");
    expect(db.queries[1].values).toContain("Добавить интересы");
  });

  it("rolls back both records if pending delivery insertion fails", async () => {
    const db = database(true);
    await expect(createNotificationWithDatabase(db, { ...base, queueTelegram: true })).rejects.toThrow("delivery failed");
    expect(db.queries.at(-1)?.sql).toBe("ROLLBACK");
    expect(db.client.release).toHaveBeenCalledOnce();
  });

  it("rejects missing admin creator and empty type or text before opening a transaction", async () => {
    const db = database();
    await expect(createNotificationWithDatabase(db, { ...base, sourceType: "admin" }))
      .rejects.toBeInstanceOf(NotificationValidationError);
    await expect(createNotificationWithDatabase(db, { ...base, notificationType: " " }))
      .rejects.toBeInstanceOf(NotificationValidationError);
    await expect(createNotificationWithDatabase(db, { ...base, text: " " }))
      .rejects.toBeInstanceOf(NotificationValidationError);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it("lists only the recipient's notifications, unread first then newest", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 4, rows: [
      { id: "unread-new", text: "Новое", action_url: "/profile", action_label: "Добавить интересы", created_at: "2026-10-03T12:00:00Z", read_at: null },
      { id: "unread-old", text: "Старое", action_url: null, created_at: "2026-10-02T12:00:00Z", read_at: null },
      { id: "read-new", text: "Прочитано позднее", action_url: null, created_at: "2026-10-04T12:00:00Z", read_at: "2026-10-04T13:00:00Z" },
      { id: "read-old", text: "Прочитано раньше", action_url: null, created_at: "2026-10-01T12:00:00Z", read_at: "2026-10-02T13:00:00Z" },
    ] }) };
    const rows = await listNotificationsWithDatabase(db, "recipient");
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("WHERE participant_id = $1::uuid"), ["recipient"]);
    expect(db.query.mock.calls[0][0]).toContain("ORDER BY (read_at IS NOT NULL), created_at DESC, id DESC");
    expect(rows.map((row) => row.id)).toEqual(["unread-new", "unread-old", "read-new", "read-old"]);
    expect(rows[0].actionUrl).toBe("/profile");
    expect(rows[0].actionLabel).toBe("Добавить интересы");
    expect(rows[1].actionLabel).toBeNull();
  });

  it("marks only its recipient's notification read and preserves the original read time", async () => {
    let readAt: string | null = null;
    const db = { query: vi.fn(async (sql: string, values?: unknown[]) => {
      expect(values).toEqual(["notification", "owner"]);
      if (sql.startsWith("UPDATE")) {
        if (readAt) return { rowCount: 0, rows: [] };
        readAt = "2026-10-04T13:00:00Z";
        return { rowCount: 1, rows: [{ id: "notification" }] };
      }
      return { rowCount: 1, rows: [{ "?column?": 1 }] };
    }) };
    expect(await markNotificationReadWithDatabase(db, "owner", "notification")).toBe(true);
    const firstReadAt = readAt;
    expect(await markNotificationReadWithDatabase(db, "owner", "notification")).toBe(true);
    expect(readAt).toBe(firstReadAt);
    expect(db.query.mock.calls[0][0]).toContain("participant_id = $2::uuid AND read_at IS NULL");
  });

  it("cannot mark another participant's notification read", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }) };
    expect(await markNotificationReadWithDatabase(db, "stranger", "notification")).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(2);
    for (const call of db.query.mock.calls) expect(call[0]).toContain("participant_id = $2::uuid");
  });
});
