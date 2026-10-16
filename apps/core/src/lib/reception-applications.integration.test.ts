import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, PUT } from "../app/api/reception/application/route";

const token = "123456:synthetic_reception_token";
vi.mock("./config", () => ({ telegramReceptionConfig: () => ({ token }) }));
vi.mock("./db", () => ({ pool: new Proxy({}, { get: (_target, key) => {
  const value = Reflect.get(db, key, db);
  return typeof value === "function" ? value.bind(db) : value;
} }) }));

const databaseUrl = process.env.RECEPTION_TEST_DATABASE_URL;
const schema = `reception_application_test_${randomUUID().replaceAll("-", "")}`;
const db = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 16 });
let created = false;
const form = { city: "Москва", occupation: "Мастер", age: 35, education: null, familyStatus: null, publishAge: false };
function signed(id = 42, signingToken = token, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify({ id, first_name: "Synthetic" }) });
  const check = [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(signingToken).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}
function request(method: string, body: unknown = form, initData: string | null = signed(), query = "") {
  return new Request(`http://core.test/api/reception/application${query}`, { method,
    headers: { "Content-Type": "application/json", ...(initData === null ? {} : { Authorization: `tma ${initData}` }) },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
}
async function application(response: Response) { return (await response.json()).application; }

describe.skipIf(!databaseUrl)("Reception applications on isolated PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/reception_tests") throw new Error("Use isolated local reception_tests");
    await db.query(`CREATE SCHEMA ${schema}`); created = true;
    const directory = new URL("../../migrations/", import.meta.url);
    for (const name of readdirSync(directory).filter(name => name.endsWith(".sql") && name < "052_").sort()) {
      await db.query("BEGIN;" + readFileSync(new URL(name, directory), "utf8") + ";COMMIT;");
    }
    const participant = (await db.query("INSERT INTO participants(display_name) VALUES ('Preserved profile') RETURNING *")).rows[0];
    await db.query("BEGIN;" + readFileSync(new URL("052_reception_applications.sql", directory), "utf8") + ";COMMIT;");
    await db.query("BEGIN;" + readFileSync(new URL("053_reception_publication.sql", directory), "utf8") + ";COMMIT;");
    await db.query("BEGIN;" + readFileSync(new URL("054_reception_invitations.sql", directory), "utf8") + ";COMMIT;");
    await db.query("BEGIN;" + readFileSync(new URL("055_reception_profile_draft.sql", directory), "utf8") + ";COMMIT;");
    expect((await db.query("SELECT * FROM participants WHERE id=$1", [participant.id])).rows[0]).toEqual(participant);
  }, 30000);
  beforeEach(async () => { await db.query("TRUNCATE reception_applications CASCADE"); });
  afterAll(async () => { if (created) await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });

  it("atomically saves application without a Participant, invitation or duplicate publication", async () => {
    const before = (await db.query("SELECT count(*) FROM participants")).rows[0];
    const response = await POST(request("POST")); expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("set-cookie")).toBeNull();
    expect(await application(response)).toMatchObject({ ...form, revision: 1, status: "submitted", invitationStatus: "not_requested" });
    expect((await db.query("SELECT count(*) FROM participants")).rows[0]).toEqual(before);
    expect((await db.query("SELECT participant_id FROM reception_applications")).rows[0].participant_id).toBeNull();
    expect((await db.query("SELECT kind FROM reception_application_deliveries")).rows).toEqual([]);
  });
  it("serializes concurrent resubmissions to one application without publication operations", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => POST(request("POST"))));
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    const values = await Promise.all(results.map(application)); expect(new Set(values.map(a => a.id)).size).toBe(1);
    expect(values.every(a => a.revision === 1)).toBe(true);
    expect((await db.query("SELECT count(*)::int AS count FROM reception_application_deliveries")).rows[0].count).toBe(0);
  });
  it("updates own data and accepts a repeated save without duplicate publication", async () => {
    const original = await application(await POST(request("POST")));
    const updated = await application(await PUT(request("PUT", { ...form, city: "  Тверь  ", publishAge: true })));
    expect(updated).toMatchObject({ id: original.id, city: "Тверь", publishAge: true, revision: 2, createdAt: original.createdAt });
    expect(await application(await PUT(request("PUT", { ...form, city: "Тверь", publishAge: false })))).toMatchObject({ id: original.id, city: "Тверь", publishAge: false, revision: 3 });
    expect((await db.query("SELECT count(*)::int AS count FROM reception_application_deliveries")).rows[0].count).toBe(0);
  });
  it("isolates candidates and rejects identity/status selectors and Core-cookie-only authentication", async () => {
    await POST(request("POST"));
    expect(await application(await GET(request("GET", null, signed(43))))).toBeNull();
    expect((await PUT(request("PUT", form, signed(43)))).status).toBe(404);
    expect((await POST(request("POST", { ...form, telegramUserId: "42" }, signed(43)))).status).toBe(400);
    expect((await GET(request("GET", null, signed(43), "?id=42"))).status).toBe(400);
    const cookieOnly = request("GET", null, null); cookieOnly.headers.set("Cookie", "dao_session=synthetic");
    expect((await GET(cookieOnly)).status).toBe(401);
    const own = await application(await GET(request("GET"))); expect(own).toMatchObject(form);
    expect(Object.keys(own)).not.toContain("participant_id"); expect(Object.keys(own)).not.toContain("telegram_user_id");
  });
  it.each(["changed", "dev", "expired", "future", "duplicate", "missing"])("rejects %s authentication before persistence", async kind => {
    let data: string | null = signed();
    if (kind === "changed") data = data.replace("%22id%22%3A42", "%22id%22%3A43");
    if (kind === "dev") data = signed(42, "dev_bot_token");
    if (kind === "expired") data = signed(42, token, Math.floor(Date.now() / 1000) - 601);
    if (kind === "future") data = signed(42, token, Math.floor(Date.now() / 1000) + 120);
    if (kind === "duplicate") data += "&user=x";
    if (kind === "missing") data = null;
    expect((await POST(request("POST", form, data))).status).toBe(401);
    expect((await db.query("SELECT count(*)::int AS count FROM reception_applications")).rows[0].count).toBe(0);
  });
  it("uses existing OIDC Telegram identity without modifying identity or profile", async () => {
    const p = (await db.query("INSERT INTO participants(display_name, profile_bio, display_name_chosen_in_core) VALUES ('Core name', 'Core bio', true) RETURNING *")).rows[0];
    const identity = (await db.query("INSERT INTO external_identities(participant_id,provider,provider_subject,external_user_id) VALUES($1,'telegram','oidc:existing','42') RETURNING *", [p.id])).rows[0];
    await POST(request("POST")); await PUT(request("PUT", { ...form, occupation: "Новые сведения" }));
    expect((await db.query("SELECT participant_id FROM reception_applications")).rows[0].participant_id).toBe(p.id);
    expect((await db.query("SELECT * FROM participants WHERE id=$1", [p.id])).rows[0]).toEqual(p);
    expect((await db.query("SELECT * FROM external_identities WHERE id=$1", [identity.id])).rows[0]).toEqual(identity);
    await db.query("DELETE FROM external_identities WHERE id=$1", [identity.id]);
  });
  it("writes confirmed application fields to the linked profile and upgrades one draft", async () => {
    const p = (await db.query("INSERT INTO participants(display_name) VALUES ('Draft owner') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO external_identities(participant_id,provider,provider_subject,external_user_id) VALUES($1,'telegram','miniapp:42','42')", [p]);
    await db.query(`INSERT INTO reception_applications(telegram_user_id,status,write_window_count,city,occupation)
      VALUES('42','draft',1,NULL,NULL)`);
    const response = await PUT(request("PUT", { ...form, education: "Высшее", familyStatus: "женат" }));
    expect(response.status).toBe(200);
    expect((await db.query("SELECT profile_city, profile_occupation, profile_education, profile_family_status FROM participants WHERE id=$1", [p])).rows[0])
      .toEqual({ profile_city: "Москва", profile_occupation: "Мастер", profile_education: "Высшее", profile_family_status: "женат" });
    expect((await db.query("SELECT count(*)::int AS count FROM reception_applications WHERE telegram_user_id='42'")).rows[0].count).toBe(1);
    expect((await db.query("SELECT count(*)::int AS count FROM reception_application_deliveries WHERE application_id=(SELECT id FROM reception_applications WHERE telegram_user_id='42')")).rows[0].count).toBe(0);
  });
  it("links an identity established after submission and refuses conflicting mappings", async () => {
    await POST(request("POST"));
    const p = (await db.query("INSERT INTO participants(display_name) VALUES ('Later login') RETURNING id")).rows[0];
    const e = (await db.query("INSERT INTO external_identities(participant_id,provider,provider_subject,external_user_id) VALUES($1,'telegram','miniapp:42','42') RETURNING id", [p.id])).rows[0];
    await POST(request("POST"));
    expect((await db.query("SELECT participant_id FROM reception_applications")).rows[0].participant_id).toBe(p.id);
    await db.query("UPDATE external_identities SET external_user_id='99' WHERE id=$1", [e.id]);
    const other = (await db.query("INSERT INTO participants(display_name) VALUES ('Other') RETURNING id")).rows[0];
    const otherE = (await db.query("INSERT INTO external_identities(participant_id,provider,provider_subject,external_user_id) VALUES($1,'telegram','oidc:other','42') RETURNING id", [other.id])).rows[0];
    expect((await PUT(request("PUT", { ...form, city: "Changed" }))).status).toBe(409);
    expect(await application(await GET(request("GET")))).toMatchObject({ city: form.city, revision: 1 });
    await db.query("DELETE FROM external_identities WHERE id=ANY($1::uuid[])", [[e.id, otherE.id]]);
  });
  it("reuses the imported roster Participant without creating an external identity", async () => {
    const p = (await db.query("INSERT INTO participants(display_name) VALUES ('Roster participant') RETURNING *")).rows[0];
    const roster = (await db.query("INSERT INTO telegram_roster_entries(telegram_user_id,display_name,is_bot,participant_id,observed_at,telegram_presence_observed_at) VALUES(42,'Roster',false,$1,now(),now()) RETURNING *", [p.id])).rows[0];
    try {
      expect((await POST(request("POST"))).status).toBe(201);
      expect((await db.query("SELECT participant_id FROM reception_applications")).rows[0].participant_id).toBe(p.id);
      expect((await db.query("SELECT * FROM participants WHERE id=$1", [p.id])).rows[0]).toEqual(p);
      expect((await db.query("SELECT * FROM telegram_roster_entries WHERE telegram_user_id=42")).rows[0]).toEqual(roster);
      expect((await db.query("SELECT count(*)::int AS count FROM external_identities WHERE participant_id=$1", [p.id])).rows[0].count).toBe(0);
    } finally { await db.query("DELETE FROM telegram_roster_entries WHERE telegram_user_id=42"); }
  });
  it("enforces a real concurrent per-candidate write quota and resets after a minute", async () => {
    const results = await Promise.all(Array.from({ length: 16 }, () => POST(request("POST"))));
    expect(results.filter(r => r.status === 429)).toHaveLength(6);
    expect(results.filter(r => r.status < 300)).toHaveLength(10);
    expect(results.find(r => r.status === 429)!.headers.get("retry-after")).toBe("60");
    await db.query("UPDATE reception_applications SET write_window_started_at=now()-interval '61 seconds'");
    expect((await PUT(request("PUT"))).status).toBe(200);
    expect((await db.query("SELECT write_window_count FROM reception_applications")).rows[0].write_window_count).toBe(1);
  });
  it("does not create a publication delivery when saving a submitted application", async () => {
    expect((await POST(request("POST"))).status).toBe(201);
    expect((await db.query("SELECT count(*)::int AS count FROM reception_application_deliveries")).rows[0].count).toBe(0);
  });
  it("guards database form constraints and delivered state", async () => {
    await POST(request("POST"));
    await expect(db.query("UPDATE reception_applications SET age=0")).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("UPDATE reception_applications SET age=null,publish_age=true")).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("UPDATE reception_application_deliveries SET status='delivered'")).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects invalid forms and malformed/oversized JSON without changing saved data", async () => {
    await POST(request("POST"));
    for (const invalid of [{ ...form, city: "" }, { ...form, age: "35" }, { ...form, age: null, publishAge: true }, { ...form, status: "closed" }]) {
      expect((await PUT(request("PUT", invalid))).status).toBe(400);
    }
    for (const body of ["{", JSON.stringify({ ...form, city: "x".repeat(8001) })]) {
      const req = new Request("http://core.test/api/reception/application", { method: "PUT", headers: { Authorization: `tma ${signed()}`, "Content-Type": "application/json" }, body });
      expect((await PUT(req)).status).toBe(400);
    }
    const wrongType = request("PUT"); wrongType.headers.set("Content-Type", "text/plain");
    expect((await PUT(wrongType)).status).toBe(400);
    expect(await application(await GET(request("GET")))).toMatchObject({ ...form, revision: 1 });
    expect((await db.query("SELECT write_window_count FROM reception_applications")).rows[0].write_window_count).toBe(1);
  });
});
