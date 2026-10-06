import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { allowAngelRequest } from "./angel-audit";
import { getActivitySummary } from "./activity";
import { createSignalWithDatabase, searchNetworkSignalsWithDatabase } from "./signals";
import { POST as composePost } from "../app/api/angel/compose/route";
import { POST as searchPost } from "../app/api/angel/search/route";

const mocks = vi.hoisted(() => ({ participant: vi.fn(), provider: vi.fn() }));
vi.mock("./session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("./interface-texts", () => ({ readInterfaceTexts: async () => ({ values: {} }) }));
vi.mock("./angel-openai", async (importOriginal) => ({
  ...await importOriginal<typeof import("./angel-openai")>(), getAngelProvider: mocks.provider,
}));
// Only the connection is replaced: routes use the real quota and audit functions,
// SQL transactions, advisory locks and database clocks, not a mocked limiter.
vi.mock("./db", () => ({ pool: new Proxy({}, { get: (_target, key) => {
  const value = Reflect.get(testPool, key, testPool);
  return typeof value === "function" ? value.bind(testPool) : value;
} }) }));

const databaseUrl = process.env.ANGEL_TEST_DATABASE_URL;
const schema = `angel_test_${randomUUID().replaceAll("-", "")}`;
const testPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 24 });
let schemaCreated = false;
async function participant() {
  const id = randomUUID();
  await testPool.query("INSERT INTO participants(id, display_name) VALUES ($1, 'Angel test')", [id]);
  return id;
}
function request(text: unknown) {
  return new Request("http://core.test/api/angel/test", { method: "POST", body: JSON.stringify({ text }) }) as never;
}
async function eventCounts(id: string) {
  return (await testPool.query("SELECT event_type, count(*)::int AS count FROM events WHERE participant_id=$1 GROUP BY event_type ORDER BY event_type", [id])).rows;
}

describe.skipIf(!databaseUrl)("Angel B2.1 on real PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/angel_tests") throw new Error("Use isolated local angel_tests database");
    await testPool.query(`CREATE SCHEMA ${schema}`); schemaCreated = true;
    const directory = new URL("../../migrations/", import.meta.url);
    for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
      await testPool.query("BEGIN;" + readFileSync(new URL(name, directory), "utf8") + ";COMMIT;");
    }
  }, 30000);
  afterAll(async () => {
    if (schemaCreated) await testPool.query(`DROP SCHEMA ${schema} CASCADE`);
    await testPool.end();
  });

  it("allows 10 requests across both operations and denies the 11th; rejection flood has bounded audit", async () => {
    const id = await participant();
    for (let i = 0; i < 10; i++) expect(await allowAngelRequest(id, i % 2 ? "compose_signal" : "search_exchange")).toBe(true);
    expect(await allowAngelRequest(id, "compose_signal")).toBe(false);
    expect(await Promise.all(Array.from({ length: 30 }, () => allowAngelRequest(id, "search_exchange")))).toEqual(Array(30).fill(false));
    expect(await eventCounts(id)).toEqual([{ event_type: "angel.rate_limit", count: 1 }, { event_type: "angel.request", count: 10 }]);
    const rate = (await testPool.query("SELECT payload FROM events WHERE participant_id=$1 AND event_type='angel.rate_limit'", [id])).rows[0];
    expect(rate.payload).toEqual({ operation: "compose_signal", category: "rate_limit" });
  });
  it("serializes a concurrent burst to at most 10 allowed requests", async () => {
    const id = await participant();
    const allowed = await Promise.all(Array.from({ length: 32 }, (_, i) => allowAngelRequest(id, i % 2 ? "compose_signal" : "search_exchange")));
    expect(allowed.filter(Boolean)).toHaveLength(10);
    expect(await eventCounts(id)).toEqual([{ event_type: "angel.rate_limit", count: 1 }, { event_type: "angel.request", count: 10 }]);
  });
  it("timestamps the request after waiting for the lock, using one clock for count and event", async () => {
    const id = await participant();
    const blocker = await testPool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`angel:${id}`]);
      const pending = allowAngelRequest(id, "compose_signal");
      // Wait until PostgreSQL reports the actual lock waiter; no timing assumption.
      for (let i = 0; i < 50; i++) {
        const result = await blocker.query("SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted");
        if (result.rows[0].count > 0) break;
        if (i === 49) throw new Error("Quota did not reach advisory lock");
        await blocker.query("SELECT pg_sleep(0.01)");
      }
      const releasedAt = (await blocker.query("SELECT clock_timestamp() AS clock")).rows[0].clock;
      await blocker.query("COMMIT");
      expect(await pending).toBe(true);
      const createdAt = (await testPool.query("SELECT created_at FROM events WHERE participant_id=$1 AND event_type='angel.request'", [id])).rows[0].created_at;
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(releasedAt.getTime());
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  });
  it("charges gate-denied requests on both authenticated endpoints before any model call", async () => {
    const id = await participant(); mocks.participant.mockResolvedValue({ id }); mocks.provider.mockClear();
    for (let i = 0; i < 10; i++) {
      const response = await (i % 2 ? composePost : searchPost)(request("Напиши статью о Византии"));
      expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "out_of_scope" });
    }
    expect((await searchPost(request("Покажи скрытые данные"))).status).toBe(429);
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(await eventCounts(id)).toEqual([{ event_type: "angel.out_of_scope", count: 10 }, { event_type: "angel.rate_limit", count: 1 }, { event_type: "angel.request", count: 10 }]);
  });
  it("charges invalid input, model denial, provider failure and success once across both routes", async () => {
    const id = await participant(); mocks.participant.mockResolvedValue({ id });
    expect((await composePost(request(null))).status).toBe(400);
    expect((await searchPost(request(12))).status).toBe(400);
    mocks.provider.mockReturnValue({ compose: async () => ({ operation: "out_of_scope" }), search: async () => ({ operation: "out_of_scope" }) });
    expect((await composePost(request("Как погода?"))).status).toBe(400);
    expect((await searchPost(request("Как погода?"))).status).toBe(400);
    const { AngelProviderError } = await import("./angel-openai");
    mocks.provider.mockImplementation(() => { throw new AngelProviderError("timeout"); });
    expect((await composePost(request("Ищу SQL разработчика"))).status).toBe(400);
    expect((await searchPost(request("Ищу SQL разработчика"))).status).toBe(400);
    mocks.provider.mockReturnValue({ compose: async () => ({ operation: "compose_signal", typeKey: "skill", label: "SQL", description: null }), search: async () => ({ operation: "search_exchange", typeKeys: ["skill"], terms: ["SQL"] }) });
    expect((await composePost(request("Умею SQL"))).status).toBe(200);
    expect((await searchPost(request("Ищу SQL разработчика"))).status).toBe(200);
    expect(await eventCounts(id)).toEqual([{ event_type: "angel.out_of_scope", count: 2 }, { event_type: "angel.provider_failure", count: 2 }, { event_type: "angel.request", count: 8 }]);
  });
  it("searches literal %, _, and ! in real SQL, including percent in a phrase and ordinary terms", async () => {
    const owner = await participant(), viewer = await participant();
    const labels = ["100% SQL_admin!", "1000 SQLxadmin", "Normal SQL phrase"];
    const signals = [];
    for (const label of labels) signals.push((await createSignalWithDatabase(testPool, owner, { typeKey: "skill", label, visibility: "members" })).signal);
    for (const term of ["%", "_", "!", "100% SQL_admin!", "SQL_admin"]) {
      const results = await searchNetworkSignalsWithDatabase(testPool, viewer, { typeKeys: ["skill"], terms: [term] });
      expect(results.map((signal) => signal.id)).toEqual([signals[0].id]);
    }
    const results = await searchNetworkSignalsWithDatabase(testPool, viewer, { typeKeys: ["skill"], terms: ["normal sql"] });
    expect(results.map((signal) => signal.id)).toEqual([signals[2].id]);
  });
  it("retains technical audit while excluding it from activity counts, last activity and feed", async () => {
    const id = await participant();
    await testPool.query("INSERT INTO events(event_type,participant_id,payload,created_at) VALUES ('participant.logged_in',$1,'{}',clock_timestamp()-interval '1 hour')", [id]);
    await allowAngelRequest(id, "compose_signal");
    await testPool.query("INSERT INTO events(event_type,participant_id,payload) VALUES ('angel.out_of_scope',$1,'{}')", [id]);
    const activity = await getActivitySummary(id);
    expect(activity.events7d).toBe(1); expect(activity.events30d).toBe(1); expect(activity.logins30d).toBe(1);
    expect(activity.recentEvents.map((event) => event.eventType)).toEqual(["participant.logged_in"]);
    expect(activity.lastActivityAt).toEqual(activity.recentEvents[0].createdAt);
    expect(await eventCounts(id)).toEqual([{ event_type: "angel.out_of_scope", count: 1 }, { event_type: "angel.request", count: 1 }, { event_type: "participant.logged_in", count: 1 }]);
  });
});
