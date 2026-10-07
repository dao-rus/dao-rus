import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigration, createMigrationPlan, migrationFile } from "./migration-integrity";
import {
  AwardAccessError, AwardConflictError, AwardNotFoundError, AwardTransitionError,
  actOnAwardInstanceWithDatabase, awardInstancePublicity, establishAwardWithDatabase,
  getAwardInstanceWithDatabase, getAwardWithDatabase, offerAwardWithDatabase, setAwardVisibilityWithDatabase,
  type AwardInstance, type EstablishAwardInput,
} from "./awards";

const databaseUrl = process.env.AWARDS_TEST_DATABASE_URL;
const schema = `awards_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
let schemaCreated = false;
let founder: string;
const legacyParticipant = randomUUID();
async function participant(status = "none") {
  const id = randomUUID();
  await pool.query("INSERT INTO participants(id, display_name, membership_status) VALUES ($1, 'Awards test', $2)", [id, status]);
  return id;
}
async function award(kind: "historical" | "open" = "historical") {
  const input: EstablishAwardInput = {
    slug: `award-${randomUUID()}`, name: kind === "historical" ? "Орден Первой волны" : "Знак Дара",
    imageUrl: "/test-award.png", establishedOn: "2026-10-07", description: "Test recognition",
    criterion: "Confirmed by founder", publicAddress: "Thank you", kind,
    historicalCutoffAt: kind === "historical" ? "2024-09-22T00:00:00+03:00" : null,
  };
  return establishAwardWithDatabase(pool, founder, input);
}
async function offer(recipient?: string) {
  const definition = await award();
  const recipientId = recipient ?? await participant();
  return (await offerAwardWithDatabase(pool, founder, {
    awardId: definition.id, participantId: recipientId, reason: "Historical participation", personalAddress: "Thank you personally",
  })).instance;
}
async function actions(instanceId: string) {
  return (await pool.query("SELECT event_type, participant_id, payload, created_at FROM events WHERE payload->>'instance_id'=$1 ORDER BY id", [instanceId])).rows;
}
async function accept(instance: AwardInstance) {
  return (await actOnAwardInstanceWithDatabase(pool, instance.participantId, instance.id, "accept")).instance;
}

describe.skipIf(!databaseUrl)("award foundation on real PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/awards_tests") throw new Error("Use isolated local awards_tests database");
    await pool.query(`CREATE SCHEMA ${schema}`); schemaCreated = true;
    const client = await pool.connect();
    try {
      await client.query("CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
      const directory = new URL("../../migrations/", import.meta.url);
      const files = readdirSync(directory).filter(name => name.endsWith(".sql")).sort()
        .map(name => migrationFile(name, readFileSync(new URL(name, directory), "utf8")));
      for (const file of files) {
        if (file.name === "042_awards.sql") {
          await client.query("INSERT INTO participants(id,display_name) VALUES ($1,'Existing profile')", [legacyParticipant]);
          await client.query("INSERT INTO events(event_type,participant_id,payload) VALUES ('participant.logged_in',$1,'{}')", [legacyParticipant]);
        }
        await applyMigration(client, file);
      }
      const applied = (await client.query("SELECT name,checksum FROM schema_migrations")).rows;
      expect(createMigrationPlan(files, applied).pending).toEqual([]);
    } finally { client.release(); }
  }, 60000);
  afterAll(async () => {
    if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });
  beforeEach(async () => { founder = await participant(); vi.stubEnv("FOUNDER_PARTICIPANT_ID", founder); });
  afterEach(() => vi.unstubAllEnvs());

  it("applies the migration through checksum machinery without altering existing profiles/events", async () => {
    expect((await pool.query("SELECT display_name FROM participants WHERE id=$1", [legacyParticipant])).rows[0].display_name).toBe("Existing profile");
    expect((await pool.query("SELECT event_type FROM events WHERE participant_id=$1", [legacyParticipant])).rows).toEqual([{ event_type: "participant.logged_in" }]);
    expect((await pool.query("SELECT count(*)::int AS count FROM schema_migrations")).rows[0].count).toBe(42);
  });
  it("establishes both award kinds, stores actual founder/version, and rejects duplicate slug", async () => {
    for (const kind of ["historical", "open"] as const) {
      const definition = await award(kind);
      expect(definition).toMatchObject({ kind, founderParticipantId: founder, charterVersion: 1, establishedOn: "2026-10-07" });
      expect(definition.historicalCutoffAt === null).toBe(kind === "open");
      expect(await getAwardWithDatabase(pool, definition.id)).toEqual(definition);
      const event = (await pool.query("SELECT * FROM events WHERE payload->>'award_id'=$1", [definition.id])).rows;
      expect(event).toHaveLength(1); expect(event[0].event_type).toBe("award.established");
      expect(event[0].participant_id).toBe(founder);
      await expect(establishAwardWithDatabase(pool, founder, { ...definition,
        historicalCutoffAt: definition.historicalCutoffAt?.toISOString() ?? null,
      })).rejects.toBeInstanceOf(AwardConflictError);
    }
  });
  it("denies technical admins and unknown Participants, and retains authors after authority changes", async () => {
    const admin = await participant(); vi.stubEnv("ADMIN_PARTICIPANT_IDS", admin);
    const definition = await award();
    await expect(establishAwardWithDatabase(pool, admin, { ...definition, slug: "unauthorized" })).rejects.toBeInstanceOf(AwardAccessError);
    await expect(offerAwardWithDatabase(pool, admin, { awardId: definition.id, participantId: admin, reason: "Test" })).rejects.toBeInstanceOf(AwardAccessError);
    await expect(offerAwardWithDatabase(pool, founder, { awardId: definition.id, participantId: randomUUID(), reason: "Test" })).rejects.toBeInstanceOf(AwardNotFoundError);
    const offered = await offer();
    vi.stubEnv("FOUNDER_PARTICIPANT_ID", admin);
    expect((await getAwardWithDatabase(pool, definition.id))?.founderParticipantId).toBe(founder);
    expect((await getAwardInstanceWithDatabase(pool, offered.id, offered.participantId))?.awardedByParticipantId).toBe(founder);
    await expect(offerAwardWithDatabase(pool, founder, { awardId: definition.id, participantId: admin, reason: "Test" })).rejects.toBeInstanceOf(AwardAccessError);
    const absentFounder = randomUUID(); vi.stubEnv("FOUNDER_PARTICIPANT_ID", absentFounder);
    await expect(establishAwardWithDatabase(pool, absentFounder, { ...definition, slug: "absent-founder",
      historicalCutoffAt: definition.historicalCutoffAt?.toISOString() ?? null,
    })).rejects.toBeInstanceOf(AwardNotFoundError);
  });
  it("offers to existing left/excluded Participants, without backdating historical awards", async () => {
    for (const status of ["left", "excluded"]) {
      const started = new Date();
      const instance = await offer(await participant(status));
      expect(instance.status).toBe("offered"); expect(instance.offeredAt.getTime()).toBeGreaterThanOrEqual(started.getTime());
      expect(instance.showInPublicList).toBe(false); expect(instance.showNextToName).toBe(false);
      expect((await actions(instance.id))[0]).toMatchObject({ event_type: "award.offered", participant_id: founder, created_at: instance.offeredAt });
    }
  });
  it("serializes eight offers into one permanent instance and one offer event", async () => {
    const definition = await award(), recipient = await participant();
    const input = { awardId: definition.id, participantId: recipient, reason: "Same reason", personalAddress: "Same address" };
    const results = await Promise.all(Array.from({ length: 8 }, () => offerAwardWithDatabase(pool, founder, input)));
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(new Set(results.map(result => result.instance.id)).size).toBe(1);
    const instanceId = results[0].instance.id;
    expect(await actions(instanceId)).toHaveLength(1);
    await expect(offerAwardWithDatabase(pool, founder, { ...input, reason: "Changed" })).rejects.toBeInstanceOf(AwardConflictError);
    await expect(pool.query("INSERT INTO award_instances(award_id,participant_id,awarded_by_participant_id,reason) VALUES ($1,$2,$3,'Duplicate')", [definition.id, recipient, founder]))
      .rejects.toMatchObject({ code: "23505" });
  });
  it("retains the refusal when offered -> declined -> accepted, then permits only final rejection", async () => {
    const offered = await offer();
    const refused = await actOnAwardInstanceWithDatabase(pool, offered.participantId, offered.id, "decline");
    const refusalRetry = await actOnAwardInstanceWithDatabase(pool, offered.participantId, offered.id, "decline");
    expect(refusalRetry.changed).toBe(false); expect(refusalRetry.instance.declinedAt).toEqual(refused.instance.declinedAt);
    const accepted = await accept(offered);
    expect(accepted.declinedAt).toEqual(refused.instance.declinedAt);
    const rejected = await actOnAwardInstanceWithDatabase(pool, offered.participantId, offered.id, "reject");
    expect(rejected.instance.acceptedAt).toEqual(accepted.acceptedAt);
    await expect(actOnAwardInstanceWithDatabase(pool, offered.participantId, offered.id, "accept")).rejects.toBeInstanceOf(AwardTransitionError);
    expect((await actions(offered.id)).map(event => event.event_type)).toEqual(["award.offered", "award.declined", "award.accepted", "award.rejected"]);
  });
  it("makes concurrent acceptance/rejection retries idempotent with stable dates and one event each", async () => {
    const offered = await offer();
    const accepts = await Promise.all(Array.from({ length: 8 }, () => actOnAwardInstanceWithDatabase(pool, offered.participantId, offered.id, "accept")));
    expect(accepts.filter(result => result.changed)).toHaveLength(1);
    expect(new Set(accepts.map(result => result.instance.acceptedAt?.getTime())).size).toBe(1);
    const rejects = await Promise.all(Array.from({ length: 8 }, () => actOnAwardInstanceWithDatabase(pool, offered.participantId, offered.id, "reject")));
    expect(rejects.filter(result => result.changed)).toHaveLength(1);
    expect(new Set(rejects.map(result => result.instance.rejectedAt?.getTime())).size).toBe(1);
    expect((await actions(offered.id)).map(event => event.event_type)).toEqual(["award.offered", "award.accepted", "award.rejected"]);
    await expect(offerAwardWithDatabase(pool, founder, { awardId: offered.awardId, participantId: offered.participantId, reason: "Award again" })).rejects.toBeInstanceOf(AwardConflictError);
  });
  it("serializes competing decline/accept and accept/reject without impossible histories", async () => {
    const offered = await offer();
    await Promise.allSettled(["accept", "decline"].map(action => actOnAwardInstanceWithDatabase(pool, offered.participantId, offered.id, action as "accept" | "decline")));
    const current = (await getAwardInstanceWithDatabase(pool, offered.id, offered.participantId))!;
    expect(current.status).toBe("accepted");
    const eventTypes = (await actions(offered.id)).map(event => event.event_type);
    expect([["award.offered", "award.accepted"], ["award.offered", "award.declined", "award.accepted"]]).toContainEqual(eventTypes);
    await Promise.allSettled(["accept", "reject"].map(action => actOnAwardInstanceWithDatabase(pool, offered.participantId, offered.id, action as "accept" | "reject")));
    expect((await getAwardInstanceWithDatabase(pool, offered.id, offered.participantId))?.status).toBe("rejected");
    expect((await actions(offered.id)).filter(event => event.event_type === "award.accepted")).toHaveLength(1);
    expect((await actions(offered.id)).filter(event => event.event_type === "award.rejected")).toHaveLength(1);
  });
  it("rejects wrong recipient actions and reads even for the founder", async () => {
    const offered = await offer();
    expect(await getAwardInstanceWithDatabase(pool, offered.id, founder)).toBeNull();
    for (const action of ["accept", "decline", "reject"] as const) {
      await expect(actOnAwardInstanceWithDatabase(pool, founder, offered.id, action)).rejects.toBeInstanceOf(AwardAccessError);
    }
    await expect(setAwardVisibilityWithDatabase(pool, founder, offered.id, { showInPublicList: true, showNextToName: true })).rejects.toBeInstanceOf(AwardAccessError);
    expect(await actions(offered.id)).toHaveLength(1);
  });
  it("changes both public flags independently and repeatedly, without changing acceptance/history", async () => {
    const accepted = await accept(await offer());
    const options = [false, true];
    for (let repeat = 0; repeat < 2; repeat++) for (const showInPublicList of options) for (const showNextToName of options) {
      const result = await setAwardVisibilityWithDatabase(pool, accepted.participantId, accepted.id, { showInPublicList, showNextToName });
      expect(result.instance.acceptedAt).toEqual(accepted.acceptedAt);
      expect(awardInstancePublicity(result.instance)).toEqual({ inPublicList: showInPublicList, nextToName: showNextToName });
      const retry = await setAwardVisibilityWithDatabase(pool, accepted.participantId, accepted.id, { showInPublicList, showNextToName });
      expect(retry.changed).toBe(false);
    }
    const rejected = (await actOnAwardInstanceWithDatabase(pool, accepted.participantId, accepted.id, "reject")).instance;
    expect(rejected.showInPublicList).toBe(true); expect(rejected.showNextToName).toBe(true);
    expect(awardInstancePublicity(rejected)).toEqual({ inPublicList: false, nextToName: false });
    await expect(setAwardVisibilityWithDatabase(pool, accepted.participantId, accepted.id, { showInPublicList: false, showNextToName: false })).rejects.toBeInstanceOf(AwardTransitionError);
  });
  it("denies domain and SQL visibility changes outside accepted", async () => {
    const offered = await offer();
    for (const status of ["offered", "declined"] as const) {
      if (status === "declined") await actOnAwardInstanceWithDatabase(pool, offered.participantId, offered.id, "decline");
      await expect(setAwardVisibilityWithDatabase(pool, offered.participantId, offered.id, { showInPublicList: true, showNextToName: false })).rejects.toBeInstanceOf(AwardTransitionError);
      await expect(pool.query("UPDATE award_instances SET show_in_public_list=true WHERE id=$1", [offered.id])).rejects.toThrow("only while accepted");
    }
  });
  it("guards state transitions and immutable dates/content against direct SQL", async () => {
    const offered = await offer();
    await expect(pool.query("UPDATE award_instances SET status='unknown' WHERE id=$1", [offered.id])).rejects.toThrow();
    await expect(pool.query("UPDATE award_instances SET status='rejected' WHERE id=$1", [offered.id])).rejects.toThrow("Invalid award instance transition");
    await expect(pool.query("UPDATE award_instances SET reason='Rewrite' WHERE id=$1", [offered.id])).rejects.toThrow("immutable");
    const accepted = await accept(offered);
    await expect(actOnAwardInstanceWithDatabase(pool, offered.participantId, offered.id, "decline")).rejects.toBeInstanceOf(AwardTransitionError);
    await expect(pool.query("UPDATE award_instances SET accepted_at=clock_timestamp() WHERE id=$1", [offered.id])).rejects.toThrow("immutable");
    await expect(pool.query("UPDATE award_instances SET status='declined' WHERE id=$1", [offered.id])).rejects.toThrow("Invalid award instance transition");
    await actOnAwardInstanceWithDatabase(pool, offered.participantId, offered.id, "reject");
    await expect(pool.query("UPDATE award_instances SET status='accepted' WHERE id=$1", [offered.id])).rejects.toThrow("Invalid award instance transition");
    expect((await getAwardInstanceWithDatabase(pool, offered.id, offered.participantId))?.acceptedAt).toEqual(accepted.acceptedAt);
  });
  it("cannot insert a preaccepted/public instance or erase a definition, instance, or linked Participant", async () => {
    const offered = await offer();
    const recipient = await participant();
    await expect(pool.query("INSERT INTO award_instances(award_id,participant_id,awarded_by_participant_id,reason,status) VALUES ($1,$2,$3,'Bypass','accepted')", [offered.awardId, recipient, founder])).rejects.toThrow("private offer");
    await expect(pool.query("INSERT INTO award_instances(award_id,participant_id,awarded_by_participant_id,reason,show_next_to_name) VALUES ($1,$2,$3,'Bypass',true)", [offered.awardId, recipient, founder])).rejects.toThrow("private offer");
    await expect(pool.query("DELETE FROM award_instances WHERE id=$1", [offered.id])).rejects.toThrow("cannot be deleted");
    await expect(pool.query("UPDATE awards SET criterion='Rewrite' WHERE id=$1", [offered.awardId])).rejects.toThrow("immutable");
    await expect(pool.query("DELETE FROM awards WHERE id=$1", [offered.awardId])).rejects.toThrow("immutable");
    for (const id of [founder, offered.participantId]) {
      await expect(pool.query("DELETE FROM participants WHERE id=$1", [id])).rejects.toMatchObject({ code: "23503" });
    }
  });
  it("enforces the complete transition matrix in PostgreSQL, including a terminal rejected state", async () => {
    const states = ["offered", "declined", "accepted", "rejected"] as const;
    const allowed = new Set(["offered:declined", "offered:accepted", "declined:accepted", "accepted:rejected"]);
    for (const from of states) for (const to of states) {
      const instance = await offer();
      if (from === "declined") await actOnAwardInstanceWithDatabase(pool, instance.participantId, instance.id, "decline");
      if (from === "accepted" || from === "rejected") await accept(instance);
      if (from === "rejected") await actOnAwardInstanceWithDatabase(pool, instance.participantId, instance.id, "reject");
      const before = await actions(instance.id);
      if (from === to || allowed.has(`${from}:${to}`)) {
        await pool.query("UPDATE award_instances SET status=$2 WHERE id=$1", [instance.id, to]);
        expect((await actions(instance.id)).length).toBe(before.length + (from === to ? 0 : 1));
      } else {
        await expect(pool.query("UPDATE award_instances SET status=$2 WHERE id=$1", [instance.id, to]))
          .rejects.toThrow("Invalid award instance transition");
        expect(await actions(instance.id)).toEqual(before);
      }
    }
  });
  it("serializes a visibility/rejection race and keeps rejected instances nonpublic", async () => {
    const instance = await accept(await offer());
    await Promise.allSettled([
      setAwardVisibilityWithDatabase(pool, instance.participantId, instance.id, { showInPublicList: true, showNextToName: true }),
      actOnAwardInstanceWithDatabase(pool, instance.participantId, instance.id, "reject"),
    ]);
    const current = (await getAwardInstanceWithDatabase(pool, instance.id, instance.participantId))!;
    expect(current.status).toBe("rejected");
    expect(awardInstancePublicity(current)).toEqual({ inPublicList: false, nextToName: false });
    const history = await actions(instance.id);
    expect(history.at(-1)?.event_type).toBe("award.rejected");
    expect(history.filter(event => event.event_type === "award.accepted")).toHaveLength(1);
  });
  it("rolls back the state transition if its audit event cannot be written", async () => {
    const offered = await offer();
    await pool.query(`CREATE FUNCTION fail_award_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type='award.accepted' THEN RAISE EXCEPTION 'Audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER fail_award_audit BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION fail_award_audit();`);
    try {
      await expect(accept(offered)).rejects.toThrow("Audit failure");
      const current = await getAwardInstanceWithDatabase(pool, offered.id, offered.participantId);
      expect(current?.status).toBe("offered"); expect(current?.acceptedAt).toBeNull();
      expect(await actions(offered.id)).toHaveLength(1);
    } finally { await pool.query("DROP TRIGGER fail_award_audit ON events; DROP FUNCTION fail_award_audit()"); }
  });
});
