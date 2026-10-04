import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimPendingDelivery } from "./notification-delivery";

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;
const schema = `notification_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 4 });
const participantId = randomUUID();
const notificationId = randomUUID();
const deliveryId = randomUUID();

describe.skipIf(!databaseUrl)("notification claim on isolated PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/notification_tests") {
      throw new Error("Use the isolated local notification_tests database");
    }
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query("CREATE TABLE participants(id uuid PRIMARY KEY)");
    const migrations = new URL("../../migrations/", import.meta.url);
    await pool.query(readFileSync(new URL("027_notifications.sql", migrations), "utf8"));
    await pool.query(readFileSync(new URL("028_notification_processing.sql", migrations), "utf8"));
    await pool.query("INSERT INTO participants(id) VALUES ($1)", [participantId]);
    await pool.query(
      `INSERT INTO notifications(id,participant_id,notification_type,text,source_type)
       VALUES ($1,$2,'test','Test text','system')`,
      [notificationId, participantId],
    );
    await pool.query(
      `INSERT INTO notification_deliveries(id,notification_id,channel,status)
       VALUES ($1,$2,'telegram','pending')`,
      [deliveryId, notificationId],
    );
  }, 30000);
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });

  it("lets exactly one concurrent worker claim the same pending row", async () => {
    const [first, second] = await Promise.all([claimPendingDelivery(pool), claimPendingDelivery(pool)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect([first, second].find(Boolean)?.id).toBe(deliveryId);
    const result = await pool.query("SELECT status, claimed_at FROM notification_deliveries WHERE id=$1", [deliveryId]);
    expect(result.rows[0].status).toBe("processing");
    expect(result.rows[0].claimed_at).not.toBeNull();
  });
});
