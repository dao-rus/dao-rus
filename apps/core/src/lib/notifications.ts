type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type NotificationClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};
export type NotificationDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<NotificationClient>;
};

export type Notification = {
  id: string;
  text: string;
  actionUrl: string | null;
  createdAt: Date;
  readAt: Date | null;
};

export type CreateNotification = {
  participantId: string;
  notificationType: string;
  text: string;
  actionUrl?: string | null;
  sourceType: "system" | "admin";
  createdByParticipantId?: string | null;
  queueTelegram?: boolean;
};

export class NotificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationValidationError";
  }
}

function safeActionUrl(value: string | null | undefined): string | null {
  if (value == null) return null;
  const url = value.trim();
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\") && !/[\u0000-\u001f]/u.test(url)) return url;
  if (/^https:\/\//iu.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return url;
    } catch { /* Invalid URL. */ }
  }
  throw new NotificationValidationError("Invalid notification action URL");
}

export async function createNotificationWithDatabase(
  database: Pick<NotificationDatabase, "connect">,
  input: CreateNotification,
): Promise<string> {
  const notificationType = input.notificationType.trim();
  const body = input.text.trim();
  if (!notificationType || !body) throw new NotificationValidationError("Notification type and text are required");
  if (input.sourceType !== "system" && input.sourceType !== "admin") {
    throw new NotificationValidationError("Invalid notification source");
  }
  if (input.sourceType === "admin" && !input.createdByParticipantId) {
    throw new NotificationValidationError("Admin notification requires a creator");
  }
  const actionUrl = safeActionUrl(input.actionUrl);

  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO notifications(participant_id, notification_type, text, action_url, source_type, created_by_participant_id)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid) RETURNING id`,
      [input.participantId, notificationType, body, actionUrl, input.sourceType, input.createdByParticipantId ?? null],
    );
    const id = String(result.rows[0].id);
    if (input.queueTelegram) {
      await client.query(
        `INSERT INTO notification_deliveries(notification_id, channel, status)
         VALUES ($1::uuid, 'telegram', 'pending')`,
        [id],
      );
    }
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listNotificationsWithDatabase(
  database: Pick<NotificationDatabase, "query">,
  participantId: string,
): Promise<Notification[]> {
  const result = await database.query(
    `SELECT id, text, action_url, created_at, read_at
       FROM notifications
      WHERE participant_id = $1::uuid
      ORDER BY (read_at IS NOT NULL), created_at DESC, id DESC`,
    [participantId],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    text: String(row.text),
    actionUrl: row.action_url ? String(row.action_url) : null,
    createdAt: new Date(String(row.created_at)),
    readAt: row.read_at ? new Date(String(row.read_at)) : null,
  }));
}

export async function countUnreadNotificationsWithDatabase(
  database: Pick<NotificationDatabase, "query">,
  participantId: string,
): Promise<number> {
  const result = await database.query(
    `SELECT count(*)::integer AS unread_count FROM notifications
      WHERE participant_id = $1::uuid AND read_at IS NULL`,
    [participantId],
  );
  return Number(result.rows[0]?.unread_count ?? 0);
}

export async function markNotificationReadWithDatabase(
  database: Pick<NotificationDatabase, "query">,
  participantId: string,
  notificationId: string,
): Promise<boolean> {
  const updated = await database.query(
    `UPDATE notifications SET read_at = now()
      WHERE id = $1::uuid AND participant_id = $2::uuid AND read_at IS NULL
      RETURNING id`,
    [notificationId, participantId],
  );
  if (updated.rowCount) return true;
  const existing = await database.query(
    `SELECT 1 FROM notifications WHERE id = $1::uuid AND participant_id = $2::uuid`,
    [notificationId, participantId],
  );
  return Boolean(existing.rowCount);
}

export async function createNotification(input: CreateNotification): Promise<string> {
  const { pool } = await import("./db");
  return createNotificationWithDatabase(pool, input);
}

export async function listNotifications(participantId: string): Promise<Notification[]> {
  const { pool } = await import("./db");
  return listNotificationsWithDatabase(pool, participantId);
}

export async function countUnreadNotifications(participantId: string): Promise<number> {
  const { pool } = await import("./db");
  return countUnreadNotificationsWithDatabase(pool, participantId);
}

export async function markNotificationRead(participantId: string, notificationId: string): Promise<boolean> {
  const { pool } = await import("./db");
  return markNotificationReadWithDatabase(pool, participantId, notificationId);
}
