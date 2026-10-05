import { describe, expect, it } from "vitest";
import { applyDepartureArchive, confirmedMappingDigest, withOcrEvidence, normalizeOcrName, departureChannel, departureReviewModel, parseArchive, previewDepartureArchive, summarizeDepartureArchive, usableArchivedUsername, type Archive, type ArchiveParticipant, type ReviewedMapping, type Review } from "./telegram-departure-archive";

const currentId = "11111111-1111-4111-8111-111111111111";
const historicalId = "22222222-2222-4222-8222-222222222222";
const people: ArchiveParticipant[] = [{ id: currentId, display_name: "Иван", usernames: ["current_ivan"], historical_usernames: ["old_ivan"] }];
const archive: Archive = { source_channel: departureChannel, messages: [
  { id: 10, date: "2020-01-02T12:30:00+03:00", text: "@old_ivan", images: [{ path: "private.png" }] },
  { id: 20, date: "2021-01-02T12:30:00Z", text: "@OLD_IVAN" },
] };
const mapping = (id = 10): ReviewedMapping => ({ source_message_id: id, archived_username: "@old_ivan", target: "historical", participant_id: null, confirmed: true, event_type: "forum.left" });
const review = (mappings: ReviewedMapping[]): Review => ({ model_version: departureReviewModel, source_channel: departureChannel, archive_sha256: "digest", mappings });
function database(current = false) {
  const events: Record<string, unknown>[] = [], participants: { id: string; display_name: string; membership_status: string }[] = [], queries: string[] = [];
  let backup: { events: typeof events; participants: typeof participants };
  const client = { async query(sql: string, values: unknown[] = []) {
    queries.push(sql);
    if (sql === "BEGIN") backup = structuredClone({ events, participants });
    if (sql === "ROLLBACK") { events.splice(0, events.length, ...backup.events); participants.splice(0, participants.length, ...backup.participants); }
    if (sql.includes("SELECT participant_id, created_at")) return { rows: events.filter(e => (!sql.includes("event_type = 'forum.left'") || e.event_type === "forum.left") && (e.payload as Record<string, unknown>).source_message_id === Number(values[1])).map(e => ({ ...e, created_at: e.created_at ? new Date(String(e.created_at)) : undefined })) };
    if (sql.includes("LEFT JOIN external_identities")) return { rows: current && values[0] === "old_ivan" ? [{ id: currentId }] : [] };
    if (sql.includes("JOIN events ev")) return { rows: participants.filter(p => p.display_name.toLowerCase() === values[1] && events.some(e => e.participant_id === p.id)).map(p => ({ id: p.id })) };
    if (sql.includes("INSERT INTO participants")) { participants.push({ id: historicalId, display_name: String(values[0]), membership_status: "left" }); return { rows: [{ id: historicalId }] }; }
    if (sql.includes("INSERT INTO events") && sql.includes("participant.created")) { events.push({ event_type: "participant.created", participant_id: values[0], payload: JSON.parse(String(values[1])) }); return { rows: [] }; }
    if (sql.includes("INSERT INTO events")) events.push({ event_type: "forum.left", participant_id: values[0], created_at: values[1], payload: JSON.parse(String(values[2])) });
    return { rows: [] };
  }, release() {} };
  return { events, participants, queries, async connect() { return client; } };
}
const preview = (text: string, participants = people) => previewDepartureArchive({ ...archive, messages: [{ ...archive.messages[0], text: "", ocr_text: text }] }, participants)[0];

describe("historical username departure model", () => {
  it("treats absence from Core as a historical creation proposal, ignoring old aliases", () => {
    expect(preview("@old_ivan").status).toBe("historical_participant_would_be_created");
    expect(preview("@old_ivan").username_options[0].current_matches).toEqual([]);
  });
  it("flags exact current usernames case insensitively; no fuzzy or name-only proposals", () => {
    expect(preview("@CURRENT_IVAN").username_options[0]).toMatchObject({ status: "existing_current_username_match", current_matches: [{ participant_id: currentId, basis: "exact_current_core_username" }] });
    expect(preview("Иван", [...people, { id: historicalId, display_name: "Иван", usernames: [] }])).toMatchObject({ status: "unresolved_no_username", username_options: [] });
    expect(preview("Незнакомый").status).toBe("unresolved_no_username");
    expect(preview("@current_ivam").status).toBe("historical_participant_would_be_created"); // Literal candidate, never similarity matching.
  });
  it("checks currently linked roster usernames but not snapshot/cache aliases", () => {
    const participants = [{ ...people[0], usernames: [], identity_evidence: [{ kind: "username" as const, value: "roster_ivan", source: "telegram_roster_entries.username" }, { kind: "username" as const, value: "cached_ivan", source: "local_roster_snapshot" }] }];
    expect(preview("@roster_ivan", participants).status).toBe("existing_current_username_match");
    expect(preview("@cached_ivan", participants).status).toBe("historical_participant_would_be_created");
  });
  it("groups repeats by case-insensitive username and forecasts unique historical Participants", () => {
    const rows = previewDepartureArchive(archive, people), summary = summarizeDepartureArchive(rows);
    expect(summary).toMatchObject({ unique_usable_archived_usernames: 1, historical_participants_would_be_created: 1, confirmed_mappings: 0, forecast_requires_reviewer_confirmation: true });
    expect(summary.repeated_username_groups[0].source_message_ids).toEqual([10, 20]);
    expect(rows.every(r => r.ocr_requires_human_confirmation)).toBe(true);
  });
  it("proposes reuse and flags multiple reconstructed Participants", () => {
    const historical = { id: historicalId, display_name: "@old_ivan", usernames: [], reconstructed_archived_usernames: ["@OLD_IVAN"] };
    expect(preview("@old_ivan", [historical]).status).toBe("reuse_historical_participant");
    expect(preview("@old_ivan", [historical, { ...historical, id: currentId }]).status).toBe("ambiguous_reconstructed_participant");
  });
  it("requires selection when several usernames occur and never repairs mixed-script or damaged tokens", () => {
    expect(preview("@old_ivan @another_user").status).toBe("username_selection_required");
    for (const token of ["@ivan_testя", "@ivan_tеst", "@ivan_test-broken", "@___", "@____"]) expect(preview(token).status).toBe("unresolved_no_username");
    expect(preview("@ old_ivan").username_options[0].evidence.repaired_ocr).toBe(true);
    expect(usableArchivedUsername("@0Oak731")).toBe("@0Oak731");
    expect(usableArchivedUsername(" @Serg ")).toBe("@Serg");
    expect(normalizeOcrName(" • Иван\u00a0  Петров | ")).toBe("Иван Петров");
    expect(normalizeOcrName("О0 l1 рp")).toBe("О0 l1 рp");
  });
  it("binds OCR evidence to unchanged archive and rejects duplicate/foreign entries", () => {
    const entry = { source_message_id: 10, ocr_text: "Иван", files: [{ words: [{ text: "Иван", confidence: 99 }] }] }, evidence = { source_channel: departureChannel, archive_sha256: "digest", entries: [entry] };
    expect(withOcrEvidence(archive, "digest", evidence).messages[0].ocr_text).toBe("Иван");
    expect(archive.messages[0].ocr_text).toBeUndefined();
    expect(() => withOcrEvidence(archive, "changed", evidence)).toThrow("exact archive");
    expect(() => withOcrEvidence(archive, "digest", { ...evidence, entries: [entry, entry] })).toThrow();
    expect(() => withOcrEvidence(archive, "digest", { ...evidence, entries: [{ ...entry, source_message_id: 1000 }] })).toThrow();
  });
  it("applies confirmed usernames to minimal left Participants with historical dates and minimal provenance", async () => {
    const db = database(), input = { ...mapping(), archived_display_name: "Архивное имя" };
    expect(await applyDepartureArchive(db, archive, "digest", review([input, { ...mapping(20), confirmed: false }]))).toEqual({ inserted: 1, skipped: 0, participantsCreated: 1 });
    expect(db.participants).toEqual([{ id: historicalId, display_name: "old_ivan", membership_status: "left" }]);
    expect(db.events.filter(e => e.event_type === "forum.left")).toEqual([{ participant_id: historicalId, event_type: "forum.left", created_at: "2020-01-02T09:30:00.000Z", payload: { source: "admin_archive_reconstruction", source_channel: departureChannel, source_message_id: 10, archived_username: "@old_ivan", archived_display_name: "Архивное имя", observed_at: "2020-01-02T09:30:00.000Z" } }]);
    expect(db.queries.some(q => /UPDATE|DELETE|INSERT INTO external_identities/.test(q))).toBe(false);
    expect(db.queries.some(q => q.includes("pg_advisory_xact_lock"))).toBe(true);
  });
  it("reuses one historical Participant for separate records and is idempotent", async () => {
    const db = database(), input = review([mapping(), { ...mapping(20), archived_username: "@OLD_IVAN" }]);
    expect(await applyDepartureArchive(db, archive, "digest", input)).toEqual({ inserted: 2, skipped: 0, participantsCreated: 1 });
    expect(await applyDepartureArchive(db, archive, "digest", input)).toEqual({ inserted: 0, skipped: 2, participantsCreated: 0 });
    expect(db.participants).toHaveLength(1); expect(db.events.filter(e => e.event_type === "forum.left")).toHaveLength(2); expect(db.events.filter(e => e.event_type === "participant.created")).toHaveLength(1);
    expect(db.events.filter(e => e.event_type === "forum.left")[1].created_at).toBe("2021-01-02T12:30:00.000Z");
  });
  it("blocks historical duplicates on current collisions, permitting only reviewed exact current selection", async () => {
    const db = database(true);
    await expect(applyDepartureArchive(db, archive, "digest", review([mapping()]))).rejects.toThrow("existing_current_username_match");
    expect(db.participants).toHaveLength(0); expect(db.events).toHaveLength(0);
    expect(await applyDepartureArchive(db, archive, "digest", review([{ ...mapping(), target: "existing_current", participant_id: currentId }]))).toEqual({ inserted: 1, skipped: 0, participantsCreated: 0 });
    expect(db.events[0].participant_id).toBe(currentId);
    expect(db.queries.some(q => /UPDATE/.test(q))).toBe(false);
  });
  it("retains millisecond occurrence precision on a pg Date idempotent readback", async () => {
    const db = database(), timed = { ...archive, messages: [{ ...archive.messages[0], date: "2020-01-02T12:30:00.123Z" }] };
    await applyDepartureArchive(db, timed, "digest", review([mapping()]));
    expect(await applyDepartureArchive(db, timed, "digest", review([mapping()]))).toEqual({ inserted: 0, skipped: 1, participantsCreated: 0 });
  });
  it("rolls back the batch if a later explicit historical selection is invalid", async () => {
    const db = database();
    await expect(applyDepartureArchive(db, archive, "digest", review([mapping(), { ...mapping(20), participant_id: currentId }]))).rejects.toThrow("requires review");
    expect(db.events).toHaveLength(0); expect(db.participants).toHaveLength(0);
  });
  it("rejects stale model/digest, removed events, bad usernames and duplicate confirmations", async () => {
    for (const input of [review([{ ...mapping(), archived_username: null }]), review([{ ...mapping(), event_type: "forum.removed" as "forum.left" }]), review([mapping(), mapping()])]) await expect(applyDepartureArchive(database(), archive, "digest", input)).rejects.toThrow("Invalid confirmed");
    await expect(applyDepartureArchive(database(), archive, "changed", review([mapping()]))).rejects.toThrow("exact exported archive");
    await expect(applyDepartureArchive(database(), archive, "digest", { ...review([mapping()]), model_version: "old" as typeof departureReviewModel })).rejects.toThrow("current review model");
  });
  it("does not create anything for unconfirmed mappings or reinterpret immutable provenance", async () => {
    const db = database();
    expect(await applyDepartureArchive(db, archive, "digest", review([{ ...mapping(), confirmed: false }]))).toEqual({ inserted: 0, skipped: 0, participantsCreated: 0 });
    await applyDepartureArchive(db, archive, "digest", review([mapping()]));
    await expect(applyDepartureArchive(db, archive, "digest", review([{ ...mapping(), archived_username: "@someone_else" }]))).rejects.toThrow("conflicts");
    expect(db.events.filter(e => e.event_type === "forum.left")).toHaveLength(1);
  });
  it("records immutable Participant creation provenance separately from departure", async () => {
    const db = database();
    await applyDepartureArchive(db, archive, "digest", review([mapping()]));
    expect(db.events.filter(e => e.event_type === "participant.created")).toEqual([{ event_type: "participant.created", participant_id: historicalId,
      payload: { source: "admin_archive_reconstruction", source_channel: departureChannel, source_message_id: 10, archived_username: "@old_ivan", archive_sha256: "digest" } }]);
  });
  it("checks the whole frozen selection and all collisions before any insert", async () => {
    const db = database(true), input = review([{ ...mapping(), archived_username: "@new_first" }, mapping(20)]);
    await expect(applyDepartureArchive(db, archive, "digest", input, { historicalOnly: true, expectedConfirmedCount: 2, expectedConfirmedSha256: confirmedMappingDigest(input) })).rejects.toThrow("existing_current_username_match");
    expect(db.queries.some(q => q.includes("INSERT"))).toBe(false);
    await expect(applyDepartureArchive(db, archive, "digest", input, { expectedConfirmedCount: 40 })).rejects.toThrow("frozen");
    await expect(applyDepartureArchive(db, archive, "digest", input, { expectedConfirmedSha256: "changed" })).rejects.toThrow("frozen");
    expect(db.queries.some(q => q.includes("INSERT"))).toBe(false);
  });
  it("validates channel, timestamps and archive message uniqueness", () => {
    expect(parseArchive(archive)).toBe(archive);
    expect(() => parseArchive({ ...archive, source_channel: "elsewhere" })).toThrow();
    expect(() => parseArchive({ ...archive, messages: [archive.messages[0], archive.messages[0]] })).toThrow();
    expect(() => parseArchive({ ...archive, messages: [{ ...archive.messages[0], date: "yesterday" }] })).toThrow();
  });
});
