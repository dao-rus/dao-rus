import { createHash } from "node:crypto";
import fs from "node:fs/promises";

export const departureChannel = "@list_of_exites";
export type ArchiveMessage = {
  id: number; date: string; text: string; ocr_text?: string;
  ocr_words?: { text: string; confidence: number }[];
  mentioned_user_ids?: string[]; images?: unknown[];
  reply_to_message_id?: number | null; grouped_id?: string | null;
};
export type Archive = { source_channel: string; messages: ArchiveMessage[] };
export type ArchiveParticipant = {
  id: string; display_name: string; telegram_user_id?: string | null;
  usernames: string[]; historical_usernames?: string[];
  historical_display_names?: string[];
  telegram_user_ids?: string[];
  identity_evidence?: IdentityEvidence[];
  reconstructed_archived_usernames?: string[];
};
export type IdentityEvidence = { kind: "username" | "display_name" | "telegram_user_id"; value: string; source: string; observed_at?: string };
type Queryable = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
export type ArchiveDatabase = { connect(): Promise<Queryable & { release(): void }> };

export function parseArchive(input: unknown): Archive {
  const archive = input as Archive;
  if (!archive || archive.source_channel !== departureChannel || !Array.isArray(archive.messages)) throw new Error("Invalid archive channel/messages");
  const ids = new Set<number>();
  for (const m of archive.messages) {
    if (!m || !Number.isSafeInteger(m.id) || m.id <= 0 || ids.has(m.id) ||
        typeof m.date !== "string" || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(m.date) || !Number.isFinite(Date.parse(m.date)) ||
        typeof m.text !== "string" || (m.ocr_text !== undefined && typeof m.ocr_text !== "string") ||
        (m.mentioned_user_ids !== undefined && (!Array.isArray(m.mentioned_user_ids) || m.mentioned_user_ids.some(id => !/^[1-9]\d*$/.test(id))))) throw new Error("Invalid archive message");
    ids.add(m.id);
  }
  return archive;
}

const username = (s: string) => s.trim().replace(/^@+/, "").trim().toLowerCase();
// Do not accept a valid prefix of a damaged/mixed-script username.
const handles = (s: string) => [...s.matchAll(/(?:^|[^\p{L}\p{N}_])@([a-zA-Z0-9_]{4,32})(?=$|[\s.,;:!?()"'<>])/gu)].map(m => username(m[1]));
export function usableArchivedUsername(value: unknown): string | null {
  return typeof value === "string" && /^@[A-Za-z0-9_]{4,32}$/.test(value.trim()) && /[A-Za-z0-9]/.test(value) ? value.trim() : null;
}
export function currentUsernameMatches(participants: ArchiveParticipant[], value: string) {
  return participants.filter(p => [...p.usernames, ...(p.identity_evidence ?? []).filter(e => e.kind === "username" && ["external_identities.username", "telegram_roster_entries.username"].includes(e.source)).map(e => e.value)]
    .some(u => username(u) === username(value)));
}
export const normalizeOcrName = (s: string) => s.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim().replace(/^[|•·]+\s*|\s*[|•·]+$/g, "");

function ocrNameLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map(normalizeOcrName);
  const statusIndex = lines.findIndex(n => /был\(?а?\)?|была|в\s?сети|last seen|^online$/i.test(n));
  const menuIndex = lines.findIndex(n => /^(чат|звук|звонок|видео|подарок|ещ[ёе]|телефон|написать)$/i.test(n));
  // Telegram's profile name precedes presence and action buttons. Biography,
  // music/channel titles and background captions below the buttons are not names.
  const header = statusIndex >= 0 ? lines.slice(0, statusIndex) : menuIndex >= 0 ? lines.slice(0, menuIndex) : lines;
  const eligible = header.filter(n => (n.match(/\p{L}/gu)?.length ?? 0) >= 3 && !n.includes("@") && n.length <= 100 &&
    !/^(?:чат|звук|звонок|видео|в сети|всети|.*был\(а\).*|был[аи]?\b.*|написать|ещ[ёе]|неизвестен|скрыт|телефон|подарок|публикации|группы|о себе|осебе|имя пользователя|уведомления|добавить.*|отправить.*|сообщение|информация|номер телефона|медиа.*|bio|username|online|last seen.*|voice.*|video.*|notifications|call)$/i.test(n));
  return statusIndex >= 0 ? eligible.slice(-2) : eligible;
}

type OcrEvidence = { source_channel: string; archive_sha256: string; entries: {
  source_message_id: number; ocr_text: string; files: { words: { text: string; confidence: number }[] }[];
}[] };
export function withOcrEvidence(archive: Archive, digest: string, input: unknown): Archive {
  const evidence = input as OcrEvidence;
  if (!evidence || evidence.source_channel !== departureChannel || evidence.archive_sha256 !== digest || !Array.isArray(evidence.entries)) throw new Error("OCR evidence must reference the exact archive");
  const entries = new Map<number, OcrEvidence["entries"][number]>();
  for (const entry of evidence.entries) {
    if (!entry || entries.has(entry.source_message_id) || !archive.messages.some(m => m.id === entry.source_message_id) || typeof entry.ocr_text !== "string" ||
        !Array.isArray(entry.files) || entry.files.some(f => !Array.isArray(f.words) || f.words.some(w => typeof w.text !== "string" || !Number.isFinite(w.confidence) || w.confidence < -1 || w.confidence > 100))) throw new Error("Invalid OCR evidence entry");
    entries.set(entry.source_message_id, entry);
  }
  return { ...archive, messages: archive.messages.map(m => {
    const entry = entries.get(m.id);
    return entry ? { ...m, ocr_text: entry.ocr_text, ocr_words: entry.files.flatMap(f => f.words) } : m;
  }) };
}
export function previewDepartureArchive(archive: Archive, participants: ArchiveParticipant[]) {
  parseArchive(archive);
  return archive.messages.map(m => {
    const context = archive.messages.filter(other => other.id !== m.id &&
      (other.id === m.reply_to_message_id || (m.grouped_id && other.grouped_id === m.grouped_id)));
    const rawOcr = m.ocr_text ?? "";
    const direct = handles(m.text), visual = handles(rawOcr), contextual = context.flatMap(c => handles(c.text));
    // Only whitespace after a visible @ can be repaired; every option needs review.
    const repairedVisual = handles(rawOcr.replace(/@[ \t]+(?=[A-Za-z0-9])/g, "@"));
    const ocrNames = ocrNameLines(rawOcr);
    const values = [...new Set([...direct, ...visual, ...repairedVisual, ...contextual])].map(u => "@" + u).filter(u => usableArchivedUsername(u));
    const options = values.map(archived_username => {
      const current = currentUsernameMatches(participants, archived_username);
      const reconstructed = participants.filter(p => p.reconstructed_archived_usernames?.some(u => username(u) === username(archived_username)));
      return { archived_username, historical_participant_key: archived_username.toLowerCase(),
        status: current.length ? "existing_current_username_match" : reconstructed.length > 1 ? "ambiguous_reconstructed_participant" : reconstructed.length ? "reuse_historical_participant" : "historical_participant_would_be_created",
        current_matches: current.map(p => ({ participant_id: p.id, current_display_name: p.display_name, basis: "exact_current_core_username" })),
        reconstructed_matches: reconstructed.map(p => ({ participant_id: p.id, current_display_name: p.display_name, basis: "reconstructed_archived_username" })),
        evidence: { caption: direct.includes(username(archived_username)), ocr: visual.includes(username(archived_username)), repaired_ocr: repairedVisual.includes(username(archived_username)) && !visual.includes(username(archived_username)), context: contextual.includes(username(archived_username)) },
      };
    });
    return { source_message_id: m.id, archive_date: m.date,
      ocr_names: ocrNames, ocr_usernames: [...new Set([...visual, ...repairedVisual])],
      ocr_requires_human_confirmation: true,
      status: !options.length ? "unresolved_no_username" : options.length > 1 ? "username_selection_required" : options[0].status,
      username_options: options,
      context: { text: m.text, ocr_text: m.ocr_text ?? null, ocr_words: m.ocr_words ?? [], images: m.images ?? [], related_messages: context.map(c => ({ id: c.id, text: c.text })) },
    };
  });
}
export const departureReviewModel = "historical_username_v1";
export function summarizeDepartureArchive(rows: ReturnType<typeof previewDepartureArchive>) {
  const groups = new Map<string, { archived_username: string; source_message_ids: number[]; status: string; current_matches: ReturnType<typeof previewDepartureArchive>[number]["username_options"][number]["current_matches"]; reconstructed_matches: ReturnType<typeof previewDepartureArchive>[number]["username_options"][number]["reconstructed_matches"] }>();
  for (const row of rows) for (const option of row.username_options) {
    const group = groups.get(option.historical_participant_key) ?? { archived_username: option.archived_username, source_message_ids: [], status: option.status, current_matches: option.current_matches, reconstructed_matches: option.reconstructed_matches };
    group.source_message_ids.push(row.source_message_id); groups.set(option.historical_participant_key, group);
  }
  const usernames = [...groups.values()];
  return { unique_usable_archived_usernames: usernames.length,
    historical_participants_would_be_created: usernames.filter(g => g.status === "historical_participant_would_be_created").length,
    // One confirmed departure subject per message; alternative usernames are not additive.
    historical_participants_creation_upper_bound: Math.min(usernames.filter(g => g.status === "historical_participant_would_be_created").length,
      rows.filter(r => r.username_options.some(o => o.status === "historical_participant_would_be_created")).length),
    historical_participants_would_be_reused: usernames.filter(g => g.status === "reuse_historical_participant").length,
    exact_current_core_username_collisions: usernames.filter(g => g.current_matches.length).length,
    archive_entries_without_usable_username: rows.filter(r => !r.username_options.length).length,
    repeated_username_groups: usernames.filter(g => g.source_message_ids.length > 1),
    entries_requiring_username_selection: rows.filter(r => r.username_options.length > 1).map(r => r.source_message_id),
    username_groups: usernames, confirmed_mappings: 0,
    forecast_requires_reviewer_confirmation: true };
}

export async function loadArchiveParticipants(client: Queryable): Promise<ArchiveParticipant[]> {
  const sql = await fs.readFile(new URL("../../tools/telegram/departure_identity_query.sql", import.meta.url), "utf8");
  const result = await client.query(sql);
  return result.rows as ArchiveParticipant[];
}

// Existing local roster snapshots provide aliases only when the stable Telegram ID
// is already bound to a Core Participant. They never create/link identities.
export function addHistoricalRosterAliases(participants: ArchiveParticipant[], input: unknown, source = "local_roster_snapshot") {
  const snapshot = input as { observed_at?: string; entries?: { telegram_user_id: string; username?: string | null; display_name?: string; observed_at?: string | null }[] };
  if (!snapshot || !Array.isArray(snapshot.entries)) throw new Error("Invalid historical roster snapshot");
  for (const entry of snapshot.entries) {
    if (typeof entry.telegram_user_id !== "string" || !/^[1-9]\d*$/.test(entry.telegram_user_id) ||
        (entry.username != null && typeof entry.username !== "string")) throw new Error("Invalid historical roster identity");
    for (const p of participants.filter(p => p.telegram_user_id === entry.telegram_user_id || p.telegram_user_ids?.includes(entry.telegram_user_id))) {
      if (entry.username) p.historical_usernames = [...new Set([...(p.historical_usernames ?? []), entry.username])];
      if (typeof entry.display_name === "string" && entry.display_name.trim()) p.historical_display_names = [...new Set([...(p.historical_display_names ?? []), entry.display_name])];
      p.identity_evidence ??= [];
      for (const [kind, value] of [["username", entry.username], ["display_name", entry.display_name]] as const) {
        if (typeof value === "string" && value.trim()) p.identity_evidence.push({ kind, value, source: source + ":telegram_user_id=" + entry.telegram_user_id, observed_at: entry.observed_at ?? snapshot.observed_at });
      }
    }
  }
}

export function archiveDigest(source: string) { return createHash("sha256").update(source).digest("hex"); }
export type ReviewedMapping = { source_message_id: number; archived_username: string | null; archived_display_name?: string;
  participant_id: string | null; target: "historical" | "existing_current" | null; confirmed: boolean; event_type: "forum.left" };
export type Review = { model_version: typeof departureReviewModel; source_channel: string; archive_sha256: string; mappings: ReviewedMapping[] };
export function confirmedMappingDigest(review: Review): string {
  return archiveDigest(JSON.stringify(review.mappings.filter(m => m.confirmed === true).map(m => ({
    source_message_id: m.source_message_id, archived_username: m.archived_username,
    archived_display_name: m.archived_display_name, participant_id: m.participant_id,
    target: m.target, confirmed: m.confirmed, event_type: m.event_type,
  })).sort((a, b) => a.source_message_id - b.source_message_id)));
}
export type DepartureApplyOptions = { historicalOnly?: boolean; expectedConfirmedSha256?: string; expectedConfirmedCount?: number };

export async function applyDepartureArchive(database: ArchiveDatabase, archive: Archive, digest: string, review: Review, options: DepartureApplyOptions = {}) {
  parseArchive(archive);
  if (!review || review.model_version !== departureReviewModel || review.source_channel !== departureChannel || review.archive_sha256 !== digest || !Array.isArray(review.mappings)) throw new Error("Review must reference the exact exported archive and current review model");
  const ids = new Set<number>();
  if (review.mappings.some(m => !m || typeof m.confirmed !== "boolean")) throw new Error("Every mapping needs an explicit boolean confirmation");
  const confirmed = review.mappings.filter(m => m.confirmed === true);
  if ((options.expectedConfirmedCount !== undefined && confirmed.length !== options.expectedConfirmedCount) ||
      (options.expectedConfirmedSha256 !== undefined && confirmedMappingDigest(review) !== options.expectedConfirmedSha256)) throw new Error("Confirmed mappings differ from the frozen reviewed selection");
  for (const m of confirmed) {
    if (m.event_type !== "forum.left" || !usableArchivedUsername(m.archived_username) || !["historical", "existing_current"].includes(String(m.target)) ||
        (m.target === "existing_current" && !m.participant_id) ||
        (m.participant_id !== null && (typeof m.participant_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.participant_id))) ||
        (m.archived_display_name !== undefined && (typeof m.archived_display_name !== "string" || m.archived_display_name.length > 200)) ||
        ids.has(m.source_message_id) || !archive.messages.some(a => a.id === m.source_message_id)) throw new Error("Invalid confirmed mapping");
    ids.add(m.source_message_id);
    if (options.historicalOnly && (m.target !== "historical" || m.participant_id !== null)) throw new Error("Historical-only apply requires reviewed historical targets without existing IDs");
  }
  const client = await database.connect();
  let inserted = 0, skipped = 0, participantsCreated = 0;
  try {
    await client.query("BEGIN");
    // Serialize all importer runs, including mappings to different Participants.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["admin_archive_reconstruction:" + departureChannel]);
    await client.query("SET LOCAL lock_timeout = '5s'");
    // Prevent a concurrent identity/roster write between preflight and commit.
    await client.query("LOCK TABLE external_identities, telegram_roster_entries IN SHARE MODE");
    const currentByMessage = new Map<number, Record<string, unknown>[]>();
    for (const m of confirmed) {
      const current = await client.query(`SELECT DISTINCT p.id, p.display_name FROM participants p
        LEFT JOIN external_identities e ON e.participant_id = p.id AND e.provider = 'telegram'
        LEFT JOIN telegram_roster_entries r ON r.participant_id = p.id
        WHERE lower(btrim(ltrim(btrim(e.username), '@'))) = $1 OR lower(btrim(ltrim(btrim(r.username), '@'))) = $1`, [username(m.archived_username!)]);
      currentByMessage.set(m.source_message_id, current.rows);
      if (current.rows.length && (options.historicalOnly || m.target === "historical")) throw new Error(`existing_current_username_match: message ${m.source_message_id}, ${m.archived_username}, ${JSON.stringify(current.rows)}; no writes applied`);
      if (m.target === "existing_current" && !current.rows.some(p => p.id === m.participant_id)) throw new Error("Reviewed current username collision no longer matches");
    }
    for (const m of confirmed) {
      const message = archive.messages.find(a => a.id === m.source_message_id)!;
      const occurredAt = new Date(message.date).toISOString();
      const archivedUsername = usableArchivedUsername(m.archived_username)!;
      const existing = await client.query(`SELECT participant_id, created_at, event_type, payload FROM events
        WHERE event_type = 'forum.left' AND payload->>'source' = 'admin_archive_reconstruction'
        AND payload->>'source_channel' = $1 AND payload->>'source_message_id' = $2`, [departureChannel, String(m.source_message_id)]);
      if (existing.rows.length) {
        const row = existing.rows[0], payload = row.payload as Record<string, unknown>;
        const existingOccurredAt = row.created_at instanceof Date ? row.created_at.toISOString() : new Date(String(row.created_at)).toISOString();
        if (existing.rows.length !== 1 || (m.participant_id && row.participant_id !== m.participant_id) || row.event_type !== "forum.left" || existingOccurredAt !== occurredAt ||
            !payload || typeof payload.archived_username !== "string" || username(payload.archived_username) !== username(archivedUsername) || payload.observed_at !== occurredAt || payload.archived_display_name !== m.archived_display_name) throw new Error("Existing provenance conflicts with reviewed mapping");
        skipped++; continue;
      }
      const current = { rows: currentByMessage.get(m.source_message_id)! };
      let participantId = m.participant_id;
      if (m.target === "existing_current") {
        if (!current.rows.some(p => p.id === participantId)) throw new Error("Reviewed current username collision no longer matches");
      } else {
        const historical = await client.query(`SELECT DISTINCT p.id FROM participants p JOIN events ev ON ev.participant_id = p.id
          WHERE ev.event_type = 'participant.created' AND ev.payload->>'source' = 'admin_archive_reconstruction'
          AND ev.payload->>'source_channel' = $1
          AND lower(btrim(ltrim(btrim(ev.payload->>'archived_username'), '@'))) = $2`, [departureChannel, username(archivedUsername)]);
        if (historical.rows.length > 1) throw new Error("Several reconstructed Participants represent this username");
        if (historical.rows.length) {
          const id = String(historical.rows[0].id);
          if ((participantId && participantId !== id) || (current.rows.length && participantId !== id)) throw new Error("Historical participant selection requires review");
          participantId = id;
        } else {
          if (current.rows.length) throw new Error("existing_current_username_match: historical duplicate creation blocked");
          if (participantId) throw new Error("Reviewed reconstructed Participant does not exist");
          const created = await client.query("INSERT INTO participants(display_name, membership_status) VALUES ($1, 'left') RETURNING id", [archivedUsername.slice(1)]);
          participantId = String(created.rows[0].id); participantsCreated++;
          await client.query(`INSERT INTO events(event_type, participant_id, payload)
            VALUES ('participant.created', $1, $2::jsonb)`, [participantId, JSON.stringify({
            source: "admin_archive_reconstruction", source_channel: departureChannel, source_message_id: m.source_message_id,
            archived_username: archivedUsername, archive_sha256: digest,
          })]);
        }
      }
      await client.query(`INSERT INTO events(event_type, participant_id, created_at, payload)
        VALUES ('forum.left', $1, $2::timestamptz, $3::jsonb)`, [participantId, occurredAt,
        JSON.stringify({ source: "admin_archive_reconstruction", source_message_id: m.source_message_id, source_channel: departureChannel,
          archived_username: archivedUsername, ...(m.archived_display_name === undefined ? {} : { archived_display_name: m.archived_display_name }), observed_at: occurredAt })]);
      inserted++;
    }
    await client.query("COMMIT");
    return { inserted, skipped, participantsCreated };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
