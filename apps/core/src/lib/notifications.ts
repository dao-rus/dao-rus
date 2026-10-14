import { safeActionUrl } from "./notification-action-url";

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
  actionLabel: string | null;
  createdAt: Date;
  readAt: Date | null;
  preview: string | null;
};

export type CreateNotification = {
  participantId: string;
  notificationType: string;
  text: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  sourceType: "system" | "admin";
  createdByParticipantId?: string | null;
  queueTelegram?: boolean;
  visibleInInbox?: boolean;
};

export class NotificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationValidationError";
  }
}

function notificationValues(input: CreateNotification): unknown[] {
  const notificationType = input.notificationType.trim();
  const body = input.text.trim();
  if (input.visibleInInbox !== undefined && typeof input.visibleInInbox !== "boolean") throw new NotificationValidationError("Invalid inbox visibility");
  if (!notificationType || !body) throw new NotificationValidationError("Notification type and text are required");
  if (input.sourceType !== "system" && input.sourceType !== "admin") {
    throw new NotificationValidationError("Invalid notification source");
  }
  if (input.sourceType === "admin" && !input.createdByParticipantId) {
    throw new NotificationValidationError("Admin notification requires a creator");
  }
  let actionUrl: string | null;
  try { actionUrl = safeActionUrl(input.actionUrl); }
  catch { throw new NotificationValidationError("Invalid notification action URL"); }
  const actionLabel = input.actionLabel?.trim() ?? null;
  if (input.actionLabel !== undefined && input.actionLabel !== null && !actionLabel) {
    throw new NotificationValidationError("Notification action label cannot be empty");
  }

  return [input.participantId, notificationType, body, actionUrl, actionLabel, input.sourceType,
    input.createdByParticipantId ?? null, input.visibleInInbox ?? true];
}

async function insertNotification(
  client: Pick<NotificationClient, "query">, input: CreateNotification, values: unknown[], notificationId?: string,
): Promise<string> {
  const result = await client.query(
    `INSERT INTO notifications(participant_id, notification_type, text, action_url, action_label, source_type, created_by_participant_id, visible_in_inbox${notificationId ? ", id" : ""})
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8${notificationId ? ", $9::uuid" : ""})
     ${notificationId ? "ON CONFLICT (id) DO NOTHING" : ""} RETURNING id`,
    notificationId ? [...values, notificationId] : values,
  );
  // A stable source UUID makes replay a no-op, including for already attempted deliveries.
  if (!result.rowCount && notificationId) return notificationId;
  const id = String(result.rows[0].id);
  if (input.queueTelegram) {
    await client.query(
      `INSERT INTO notification_deliveries(notification_id, channel, status)
       VALUES ($1::uuid, 'telegram', 'pending')`, [id],
    );
  }
  return id;
}

/** Joins the caller's transaction; notificationId, if supplied, is a trusted source UUID. */
export async function createNotificationWithClient(
  client: Pick<NotificationClient, "query">, input: CreateNotification, notificationId?: string,
): Promise<string> {
  return insertNotification(client, input, notificationValues(input), notificationId);
}

export async function createNotificationWithDatabase(
  database: Pick<NotificationDatabase, "connect">,
  input: CreateNotification,
): Promise<string> {
  const values = notificationValues(input);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const id = await insertNotification(client, input, values);
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
  unreadOnly = false,
): Promise<Notification[]> {
  const result = await database.query(
    `SELECT id, text, action_url, action_label, created_at, read_at, source_type, notification_type, campaign_id
       FROM notifications
      WHERE participant_id = $1::uuid AND visible_in_inbox
        ${unreadOnly ? "AND read_at IS NULL" : ""}
      ORDER BY (read_at IS NOT NULL), created_at DESC, id DESC`,
    [participantId],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    text: String(row.text),
    actionUrl: row.action_url ? String(row.action_url) : null,
    actionLabel: row.action_label ? String(row.action_label) : null,
    createdAt: new Date(String(row.created_at)),
    readAt: row.read_at ? new Date(String(row.read_at)) : null,
    // These are recipient-owned message snapshots, not content fetched through an action URL.
    // System notices (especially Blind Relay/Closer) retain their content-free description.
    preview: row.campaign_id || (row.source_type === "admin" && row.notification_type !== "award.offered")
      ? String(row.text) : null,
  }));
}

export async function countUnreadNotificationsWithDatabase(
  database: Pick<NotificationDatabase, "query">,
  participantId: string,
): Promise<number> {
  const result = await database.query(
    `SELECT count(*)::integer AS unread_count FROM notifications
      WHERE participant_id = $1::uuid AND read_at IS NULL AND visible_in_inbox`,
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
      WHERE id = $1::uuid AND participant_id = $2::uuid AND read_at IS NULL AND visible_in_inbox
      RETURNING id`,
    [notificationId, participantId],
  );
  if (updated.rowCount) return true;
  const existing = await database.query(
    `SELECT 1 FROM notifications WHERE id = $1::uuid AND participant_id = $2::uuid AND visible_in_inbox`,
    [notificationId, participantId],
  );
  return Boolean(existing.rowCount);
}

export async function createNotification(input: CreateNotification): Promise<string> {
  const { pool } = await import("./db");
  return createNotificationWithDatabase(pool, input);
}

export async function listNotifications(participantId: string, unreadOnly = false): Promise<Notification[]> {
  const { pool } = await import("./db");
  return listNotificationsWithDatabase(pool, participantId, unreadOnly);
}

export async function openNotificationWithDatabase(
  database: Pick<NotificationDatabase, "connect">, participantId: string, notificationId: string,
): Promise<{ actionUrl: string | null } | null> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT action_url FROM notifications WHERE id = $1::uuid AND participant_id = $2::uuid
        AND visible_in_inbox FOR UPDATE`, [notificationId, participantId]);
    if (!found.rowCount) { await client.query("COMMIT"); return null; }
    let actionUrl: string | null;
    try { actionUrl = safeActionUrl(found.rows[0].action_url as string | null); }
    catch { throw new NotificationValidationError("Invalid notification action URL"); }
    await client.query(`UPDATE notifications SET read_at = now()
      WHERE id = $1::uuid AND participant_id = $2::uuid AND visible_in_inbox AND read_at IS NULL`,
      [notificationId, participantId]);
    await client.query("COMMIT");
    return { actionUrl };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function markAllNotificationsReadWithDatabase(
  database: Pick<NotificationDatabase, "query">, participantId: string,
): Promise<number> {
  const result = await database.query(`UPDATE notifications SET read_at = now()
    WHERE participant_id = $1::uuid AND visible_in_inbox AND read_at IS NULL RETURNING id`, [participantId]);
  return result.rowCount ?? 0;
}

export async function openNotification(participantId: string, notificationId: string) {
  const { pool } = await import("./db");
  return openNotificationWithDatabase(pool, participantId, notificationId);
}

export async function markAllNotificationsRead(participantId: string) {
  const { pool } = await import("./db");
  return markAllNotificationsReadWithDatabase(pool, participantId);
}

export async function countUnreadNotifications(participantId: string): Promise<number> {
  const { pool } = await import("./db");
  return countUnreadNotificationsWithDatabase(pool, participantId);
}

export async function markNotificationRead(participantId: string, notificationId: string): Promise<boolean> {
  const { pool } = await import("./db");
  return markNotificationReadWithDatabase(pool, participantId, notificationId);
}
