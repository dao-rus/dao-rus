import { createAwardBatchWithDatabase, snapshotAwardAudienceWithDatabase, addAwardCandidateWithDatabase, editAwardCandidateWithDatabase, finalizeAwardBatchWithDatabase, notifyAwardBatchRecipientsWithDatabase } from "./award-batches";
import { getPublicAwardWithDatabase, getAwardBadgesWithDatabase, getOwnAwardOffersWithDatabase } from "./award-views";
import { selectParticipantAudienceWithDatabase } from "./participant-audience";
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
  async function editedCandidate(batch:string,recipient:string,status="included",reason="Contribution",address="Private memory") {
    const candidate=(await pool.query("SELECT id FROM award_candidates WHERE batch_id=$1 AND participant_id=$2",[batch,recipient])).rows[0];
    await editAwardCandidateWithDatabase(pool,founder,batch,candidate.id,{status,reason,personalAddress:address});
    return candidate.id as string;
  }
  it("runs a complete release, authenticated offer projection, both public opt-ins and irreversible rejection", async()=>{
    const images={original:Buffer.from([1]),thumbnail:Buffer.from([2])};
    const definition=await establishAwardWithDatabase(pool,founder,{slug:`e2e-${randomUUID()}`,name:"Знак Дара",imageUrl:"",images,establishedOn:"2026-10-07",description:"Public description",criterion:"Founder review",publicAddress:"Public greeting",kind:"open"});
    const included=await participant(),excluded=await participant(),manual=await participant();
    const city=`Test-${randomUUID()}`;
    await pool.query("UPDATE participants SET residence_name=$2,residence_type='город',residence_country='Россия' WHERE id=ANY($1)",[[included,excluded],city]);
    const batch=await createAwardBatchWithDatabase(pool,founder,definition.id,"regular"),batchId=String(batch.id);
    await snapshotAwardAudienceWithDatabase(pool,founder,batchId,{city:JSON.stringify([city.toLowerCase(),"город","россия"])});
    expect((await pool.query("SELECT count(*)::int AS n FROM award_instances WHERE award_id=$1",[definition.id])).rows[0].n).toBe(0);
    await pool.query("UPDATE participants SET residence_name='Changed' WHERE id=$1",[included]);
    expect((await pool.query("SELECT count(*)::int AS n FROM award_candidates WHERE batch_id=$1",[batchId])).rows[0].n).toBe(2);
    await editedCandidate(batchId,excluded,"excluded"); await editedCandidate(batchId,excluded,"included"); await editedCandidate(batchId,excluded,"excluded");
    await addAwardCandidateWithDatabase(pool,founder,batchId,manual); await addAwardCandidateWithDatabase(pool,founder,batchId,manual);
    const candidate=await editedCandidate(batchId,included); await editedCandidate(batchId,manual);
    const [release,retry]=await Promise.all([finalizeAwardBatchWithDatabase(pool,founder,batchId),finalizeAwardBatchWithDatabase(pool,founder,batchId)]);
    expect(release).toHaveLength(2); expect(retry).toEqual(release);
    const instanceId=String(release.find(r=>r.participant_id===included)!.id);
    await expect(editAwardCandidateWithDatabase(pool,founder,batchId,candidate,{status:"excluded",reason:"x",personalAddress:""})).rejects.toBeInstanceOf(AwardTransitionError);
    await expect(pool.query("UPDATE award_candidates SET reason='changed' WHERE id=$1",[candidate])).rejects.toThrow();
    expect(await getOwnAwardOffersWithDatabase(pool,manual,instanceId)).toEqual([]);
    expect((await getOwnAwardOffersWithDatabase(pool,included,instanceId))[0].instance.personalAddress).toBe("Private memory");
    expect((await getPublicAwardWithDatabase(pool,definition.slug))!.recipients).toEqual([]);
    await actOnAwardInstanceWithDatabase(pool,included,instanceId,"decline"); await actOnAwardInstanceWithDatabase(pool,included,instanceId,"accept");
    await setAwardVisibilityWithDatabase(pool,included,instanceId,{showInPublicList:true,showNextToName:false});
    expect((await getPublicAwardWithDatabase(pool,definition.slug))!.recipients).toHaveLength(1);
    expect(await getAwardBadgesWithDatabase(pool,[included,manual])).toEqual({});
    await setAwardVisibilityWithDatabase(pool,included,instanceId,{showInPublicList:false,showNextToName:true});
    expect((await getPublicAwardWithDatabase(pool,definition.slug))!.recipients).toEqual([]);
    expect((await getAwardBadgesWithDatabase(pool,[included]))[included]).toHaveLength(1);
    await setAwardVisibilityWithDatabase(pool,included,instanceId,{showInPublicList:true,showNextToName:true});
    await actOnAwardInstanceWithDatabase(pool,included,instanceId,"reject");
    const retained=(await pool.query("SELECT status,reason,personal_address,batch_id,declined_at,accepted_at,rejected_at FROM award_instances WHERE id=$1",[instanceId])).rows[0];
    expect(retained).toMatchObject({status:"rejected",reason:"Contribution",personal_address:"Private memory",batch_id:batchId});
    expect(retained.declined_at).toBeInstanceOf(Date); expect(retained.accepted_at).toBeInstanceOf(Date); expect(retained.rejected_at).toBeInstanceOf(Date);
    expect((await pool.query("SELECT count(*)::int AS n FROM award_candidates WHERE batch_id=$1",[batchId])).rows[0].n).toBe(3);
    expect((await getPublicAwardWithDatabase(pool,definition.slug))!.recipients).toEqual([]);
    expect(await getAwardBadgesWithDatabase(pool,[included])).toEqual({});
    await expect(actOnAwardInstanceWithDatabase(pool,included,instanceId,"accept")).rejects.toBeInstanceOf(AwardTransitionError);
    expect((await pool.query("SELECT count(*)::int AS n FROM events WHERE event_type='award.batch_finalized' AND payload->>'batch_id'=$1",[batchId])).rows[0].n).toBe(1);
    expect((await actions(instanceId)).map(e=>e.event_type)).toEqual(["award.offered","award.declined","award.accepted","award.visibility_changed","award.visibility_changed","award.visibility_changed","award.rejected"]);
  });
  it("rolls back an entire conflicting remint, supports fresh historical recipients and denies open remint",async()=>{
    const definition=await award(),old=await participant(),fresh=await participant();
    await offerAwardWithDatabase(pool,founder,{awardId:definition.id,participantId:old,reason:"Already awarded"});
    const batch=String((await createAwardBatchWithDatabase(pool,founder,definition.id,"remint")).id);
    for(const p of [old,fresh]) { await addAwardCandidateWithDatabase(pool,founder,batch,p); await editedCandidate(batch,p); }
    await expect(finalizeAwardBatchWithDatabase(pool,founder,batch)).rejects.toBeInstanceOf(AwardConflictError);
    expect((await pool.query("SELECT status FROM award_batches WHERE id=$1",[batch])).rows[0].status).toBe("draft");
    expect((await pool.query("SELECT id FROM award_instances WHERE batch_id=$1",[batch])).rows).toEqual([]);
    await editedCandidate(batch,old,"excluded"); expect(await finalizeAwardBatchWithDatabase(pool,founder,batch)).toHaveLength(1);
    const open=await award("open"); await expect(createAwardBatchWithDatabase(pool,founder,open.id,"remint")).rejects.toThrow("historical");
    await expect(createAwardBatchWithDatabase(pool,fresh,open.id,"regular")).rejects.toBeInstanceOf(AwardAccessError);
    await expect(addAwardCandidateWithDatabase(pool,fresh,batch,fresh)).rejects.toBeInstanceOf(AwardAccessError);
    await expect(finalizeAwardBatchWithDatabase(pool,fresh,batch)).rejects.toBeInstanceOf(AwardAccessError);
  });
  it("serializes competing batches and rejects incomplete direct SQL release",async()=>{
    const definition=await award(),recipient=await participant();
    const batches=await Promise.all([createAwardBatchWithDatabase(pool,founder,definition.id,"regular"),createAwardBatchWithDatabase(pool,founder,definition.id,"regular")]);
    for(const b of batches) { await addAwardCandidateWithDatabase(pool,founder,String(b.id),recipient); await editedCandidate(String(b.id),recipient); }
    const competing=await Promise.allSettled(batches.map(b=>finalizeAwardBatchWithDatabase(pool,founder,String(b.id))));
    expect(competing.filter(r=>r.status==="fulfilled")).toHaveLength(1); expect(competing.filter(r=>r.status==="rejected")).toHaveLength(1);
    const other=await participant(),draft=String((await createAwardBatchWithDatabase(pool,founder,definition.id,"regular")).id);
    await addAwardCandidateWithDatabase(pool,founder,draft,other); await editedCandidate(draft,other);
    await expect(pool.query("INSERT INTO award_instances(award_id,participant_id,awarded_by_participant_id,reason,personal_address,batch_id) VALUES ($1,$2,$3,'Contribution','Private memory',$4)",[definition.id,other,founder,draft])).rejects.toThrow("before finalization");
    await expect(pool.query("UPDATE award_batches SET status='finalized',finalized_by_participant_id=$2 WHERE id=$1",[draft,founder])).rejects.toThrow("matching offers");
    await expect(finalizeAwardBatchWithDatabase(pool,founder,String((await createAwardBatchWithDatabase(pool,founder,definition.id,"regular")).id))).rejects.toThrow("reason");
  });
  it("awards share trait filters without guardian delivery eligibility",async()=>{
    const recipient=await participant("left"),city=`Audience-${randomUUID()}`;
    await pool.query("UPDATE participants SET residence_name=$2,residence_type='город',residence_country='Россия' WHERE id=$1",[recipient,city]);
    const filters={city:JSON.stringify([city.toLowerCase(),"город","россия"]),membership:"left",verification:"unverified"};
    expect((await selectParticipantAudienceWithDatabase(pool,filters,"awards")).audience.map(p=>p.id)).toEqual([recipient]);
    expect((await selectParticipantAudienceWithDatabase(pool,filters,"guardian")).audience).toEqual([]);
  });
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
    expect((await pool.query("SELECT count(*)::int AS count FROM schema_migrations")).rows[0].count).toBe(readdirSync(new URL("../../migrations/", import.meta.url)).filter(name => name.endsWith(".sql")).length);
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
  }, 15000); // Sixteen real PostgreSQL fixtures and transitions also run under full-suite load.
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
  it("notifies recipients of a finalized batch exactly once, skips answered offers and never leaks private content", async () => {
    const definition = await award();
    const [first, second, third] = [await participant(), await participant(), await participant()];
    const batch = String((await createAwardBatchWithDatabase(pool, founder, definition.id, "regular")).id);
    for (const person of [first, second, third]) { await addAwardCandidateWithDatabase(pool, founder, batch, person); await editedCandidate(batch, person, "included", "PRIVATE_REASON", "PRIVATE_ADDRESS"); }
    const texts = { text: "Награда «{name}» ждёт вас", action: "Открыть" };
    await expect(notifyAwardBatchRecipientsWithDatabase(pool, founder, batch, texts)).rejects.toBeInstanceOf(AwardTransitionError);
    await expect(notifyAwardBatchRecipientsWithDatabase(pool, randomUUID(), batch, texts)).rejects.toBeInstanceOf(AwardAccessError);
    await expect(notifyAwardBatchRecipientsWithDatabase(pool, founder, randomUUID(), texts)).rejects.toBeInstanceOf(AwardNotFoundError);
    const release = await finalizeAwardBatchWithDatabase(pool, founder, batch);
    const byPerson = Object.fromEntries(release.map(row => [String(row.participant_id), String(row.id)]));
    await actOnAwardInstanceWithDatabase(pool, second, byPerson[second], "decline");
    await actOnAwardInstanceWithDatabase(pool, third, byPerson[third], "accept");
    // Concurrent double click and a later retry: one notice per still-open offer.
    const sent = await Promise.all([notifyAwardBatchRecipientsWithDatabase(pool, founder, batch, texts), notifyAwardBatchRecipientsWithDatabase(pool, founder, batch, texts)]);
    expect(sent.sort()).toEqual([0, 1]);
    expect(await notifyAwardBatchRecipientsWithDatabase(pool, founder, batch, texts)).toBe(0);
    const notices = (await pool.query("SELECT n.*, d.channel, d.status AS delivery FROM notifications n LEFT JOIN notification_deliveries d ON d.notification_id=n.id WHERE n.notification_type='award.offered' AND n.participant_id=ANY($1)", [[first, second, third]])).rows;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ participant_id: first, action_url: `/award-offers/${byPerson[first]}`, action_label: "Открыть", source_type: "admin", created_by_participant_id: founder, channel: "telegram", delivery: "pending" });
    expect(notices[0].text).toBe("Награда «Орден Первой волны» ждёт вас");
    expect(JSON.stringify(notices[0])).not.toContain("PRIVATE");
    // A recipient who declined may still change their mind; that answer does not re-open the notice.
    await actOnAwardInstanceWithDatabase(pool, first, byPerson[first], "decline");
    expect(await notifyAwardBatchRecipientsWithDatabase(pool, founder, batch, texts)).toBe(0);
  });
  it("rolls back every notice of a run when one cannot be written", async () => {
    const definition = await award();
    const [first, second] = [await participant(), await participant()];
    const batch = String((await createAwardBatchWithDatabase(pool, founder, definition.id, "regular")).id);
    for (const person of [first, second]) { await addAwardCandidateWithDatabase(pool, founder, batch, person); await editedCandidate(batch, person); }
    await finalizeAwardBatchWithDatabase(pool, founder, batch);
    const failing = [first, second].sort()[1];
    await pool.query(`CREATE FUNCTION fail_award_notice() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.participant_id='${failing}' THEN RAISE EXCEPTION 'Notice failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER fail_award_notice BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_award_notice();`);
    try {
      await expect(notifyAwardBatchRecipientsWithDatabase(pool, founder, batch, { text: "{name}", action: "Открыть" })).rejects.toThrow("Notice failure");
      expect((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE notification_type='award.offered' AND participant_id=ANY($1)", [[first, second]])).rows[0].n).toBe(0);
    } finally { await pool.query("DROP TRIGGER fail_award_notice ON notifications; DROP FUNCTION fail_award_notice()"); }
    expect(await notifyAwardBatchRecipientsWithDatabase(pool, founder, batch, { text: "{name}", action: "Открыть" })).toBe(2);
  });
});
