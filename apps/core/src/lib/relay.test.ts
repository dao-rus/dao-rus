import { describe, expect, it, vi } from "vitest";
import {
  cancelRelayEncounterWithDatabase,
  consentRelayRevealWithDatabase,
  createRelayEncounterWithDatabase,
  respondToSignalWithDatabase,
  getRelayEncounterWithDatabase,
  listExchangeSignalsWithDatabase,
  listRelayMessagesWithDatabase,
  sendRelayMessageWithDatabase,
  type RelayDatabase,
} from "./relay";

const author = "10000000-0000-4000-8000-000000000001";
const responder = "20000000-0000-4000-8000-000000000002";
const outsider = "30000000-0000-4000-8000-000000000003";
const signal = "40000000-0000-4000-8000-000000000004";
const encounter = "50000000-0000-4000-8000-000000000005";

function databaseWith(query: RelayDatabase["query"]) {
  return { query: vi.fn(query) };
}

describe("Blind Match privacy and Relay access", () => {
  it("lists active visible network signals without serializing blind authors", async () => {
    const database = databaseWith(async () => ({ rowCount: 2, rows: [
      { id: signal, kind: "need", label: "Нужна помощь", description: null, visibility: "network_blind", mine: false,
        author_id: author, author_name: "Скрытое имя" },
      { id: encounter, kind: "need", label: "Нужны материалы", description: null, visibility: "members", mine: false,
        author_id: author, author_name: "Анна" },
    ] }));
    const signals = await listExchangeSignalsWithDatabase(database, responder, "need");
    expect(signals[0]).toEqual({ id: signal, kind: "need", body: "Нужна помощь",
      mine: false, anonymous: true, author: null });
    expect(signals[1].author).toEqual({ id: author, name: "Анна" });
    const [sql, values] = database.query.mock.calls[0];
    expect(sql).toContain("s.status = 'active'");
    expect(sql).toContain("s.visibility IN ('public', 'members', 'network_blind')");
    expect(sql).toContain("CASE WHEN s.visibility <> 'network_blind' THEN author.id END");
    expect(sql).toContain("ORDER BY s.created_at DESC, s.id DESC");
    expect(sql).not.toContain("match_only");
    expect(values).toEqual([responder, "need"]);
  });

  it("refuses self-response and closed or archived signals at the database boundary", async () => {
    const database = databaseWith(async () => ({ rowCount: 0, rows: [] }));
    await expect(createRelayEncounterWithDatabase(database, author, signal))
      .rejects.toThrow("unavailable");
    const sql = database.query.mock.calls.at(-1)![0];
    expect(sql).toContain("s.participant_id <> $2::uuid");
    expect(sql).toContain("s.status = 'active'");
    expect(sql).toContain("s.visibility = 'network_blind'");
    expect(sql).toContain("FOR UPDATE OF s");
  });

  it("creates a separate dialog for each responder, and returns a responder to their existing one", async () => {
    const dialogs = new Map<string, string>();
    const database = databaseWith(async (sql, values) => {
      const key = String(values?.[1]);
      if (sql.includes("SELECT id FROM relay_encounters")) {
        return dialogs.has(key) ? { rowCount: 1, rows: [{ id: dialogs.get(key) }] } : { rowCount: 0, rows: [] };
      }
      dialogs.set(key, key === responder ? encounter : outsider);
      return { rowCount: 1, rows: [{ id: dialogs.get(key), author_id: author }] };
    });
    expect(await respondToSignalWithDatabase(database, responder, signal)).toEqual({ encounterId: encounter, created: true, authorId: author });
    expect(await respondToSignalWithDatabase(database, outsider, signal)).toEqual({ encounterId: outsider, created: true, authorId: author });
    // The same person pressing "respond" again is led back, and the author is not told twice.
    expect(await respondToSignalWithDatabase(database, responder, signal)).toEqual({ encounterId: encounter, created: false, authorId: null });
    expect(await createRelayEncounterWithDatabase(database, responder, signal)).toBe(encounter);
    expect(database.query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO relay_encounters"))).toHaveLength(2);
  });

  it("returns no encounter or messages for an outsider and forbids outsider messages", async () => {
    const database = databaseWith(async () => ({ rowCount: 0, rows: [] }));
    expect(await getRelayEncounterWithDatabase(database, outsider, encounter)).toBeNull();
    expect(await listRelayMessagesWithDatabase(database, outsider, encounter)).toEqual([]);
    await expect(sendRelayMessageWithDatabase(database, outsider, encounter, "Привет"))
      .rejects.toThrow("unavailable");
    for (const [sql] of database.query.mock.calls) {
      expect(sql).toContain("e.author_id = $2::uuid OR e.responder_id = $2::uuid");
    }
  });

  it("never serializes the other party's identity before both consent, even if a row contains it", async () => {
    const database = databaseWith(async () => ({
      rowCount: 1, rows: [{
        id: encounter, kind: "need", body: "Нужна помощь", status: "active",
        role: "author", my_consent: true, other_id: responder,
        other_name: "Скрытое имя", other_username: "secret",
      }],
    }));
    const detail = await getRelayEncounterWithDatabase(database, author, encounter);
    expect(detail).toMatchObject({ myConsent: true, other: null });
    const sql = database.query.mock.calls[0][0];
    expect(sql).toContain("CASE WHEN e.status = 'revealed' THEN other.id END");
    expect(sql).toContain("CASE WHEN e.status = 'revealed' THEN other.display_name END");
    expect(sql).toContain("CASE WHEN e.status = 'revealed' THEN identity.username END");
  });

  it("reveals only after independent consent from both parties", async () => {
    let authorConsent = false;
    let responderConsent = false;
    let status = "active";
    const database = databaseWith(async (sql, values) => {
      if (sql.includes("UPDATE relay_encounters")) {
        if (values?.[1] === author) authorConsent = true;
        if (values?.[1] === responder) responderConsent = true;
        if (authorConsent && responderConsent) status = "revealed";
        return { rowCount: 1, rows: [{ id: encounter }] };
      }
      return { rowCount: 1, rows: [{
        id: encounter, kind: "need", body: "Нужна помощь", status,
        role: values?.[1] === author ? "author" : "responder",
        my_consent: values?.[1] === author ? authorConsent : responderConsent,
        other_id: responder, other_name: "Борис", other_username: "boris",
      }] };
    });
    await consentRelayRevealWithDatabase(database, author, encounter);
    expect((await getRelayEncounterWithDatabase(database, author, encounter))?.other).toBeNull();
    expect((await getRelayEncounterWithDatabase(database, responder, encounter))?.other).toBeNull();
    await consentRelayRevealWithDatabase(database, responder, encounter);
    expect((await getRelayEncounterWithDatabase(database, author, encounter))?.other)
      .toEqual({ id: responder, name: "Борис", username: "boris" });
    const consentSql = database.query.mock.calls[0][0];
    expect(consentSql).toContain("e.status = 'active'");
    expect(consentSql).toContain("e.responder_consented_at IS NOT NULL");
    expect(consentSql).toContain("e.author_consented_at IS NOT NULL");
  });

  it("cancels without exposing identity and rejects later messages", async () => {
    let cancelled = false;
    const database = databaseWith(async (sql) => {
      if (sql.includes("SET status = 'cancelled'")) {
        cancelled = true;
        return { rowCount: 1, rows: [{ id: encounter }] };
      }
      if (sql.includes("INSERT INTO relay_messages")) {
        return { rowCount: cancelled ? 0 : 1, rows: cancelled ? [] : [{ id: signal }] };
      }
      return { rowCount: 1, rows: [{
        id: encounter, kind: "need", body: "Нужна помощь",
        status: cancelled ? "cancelled" : "active", role: "author",
        my_consent: true, other_id: responder, other_name: "Скрытое имя",
      }] };
    });
    await cancelRelayEncounterWithDatabase(database, author, encounter);
    expect((await getRelayEncounterWithDatabase(database, author, encounter))?.other).toBeNull();
    await expect(sendRelayMessageWithDatabase(database, responder, encounter, "Позднее сообщение"))
      .rejects.toThrow("unavailable");
    expect(database.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO relay_messages"))?.[0])
      .toContain("e.status IN ('active', 'revealed')");
  });
});
