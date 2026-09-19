import { describe, expect, it } from "vitest";
import {
  repairMembershipBindingWithDatabase,
} from "./membership-binding-repair";
import type {
  ParticipantRegistryDatabase,
  ParticipantRegistryDatabaseClient,
} from "./participant-registry";

const telegramUserId = "1362135676";
const adminParticipantId = "10000000-0000-0000-0000-000000000001";
const evidenceAdminId = "20000000-0000-0000-0000-000000000001";
const createdParticipantId = "30000000-0000-0000-0000-000000000001";
const existingParticipantId = "40000000-0000-0000-0000-000000000001";
const conflictingParticipantId = "50000000-0000-0000-0000-000000000001";
const evidenceOccurredAt = "2026-08-22 08:32:10.187374+00";

type PersistedEvent = {
  eventType: string;
  participantId: string;
  payload: Record<string, unknown>;
  createdAt?: string;
};

class FakeRepairClient implements ParticipantRegistryDatabaseClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;
  rosterStatus: string;
  rosterParticipantId: string | null;
  identityParticipantId: string | null;
  identityExternalUserId: string | null;
  canonicalStatus: string;
  identityVerification: string;
  persistedEvents: PersistedEvent[] = [];
  private pendingEvents: PersistedEvent[] = [];
  private transactionState: {
    rosterParticipantId: string | null;
    identityParticipantId: string | null;
    identityExternalUserId: string | null;
    canonicalStatus: string;
  } | null = null;

  constructor(
    private readonly options: {
      rosterStatus?: string;
      rosterParticipantId?: string | null;
      identityParticipantId?: string | null;
      identityExternalUserId?: string | null;
      canonicalStatus?: string;
      identityVerification?: string;
      missingRoster?: boolean;
      missingEvidence?: boolean;
      evidenceOldValue?: string;
      evidenceNewValue?: string;
      evidenceTelegramUserId?: string;
      evidenceChangedByParticipantId?: string;
      evidenceEventParticipantId?: string | null;
      existingRepairHistory?: boolean;
      failEventType?: string;
      failIdentityInsert?: boolean;
    } = {},
  ) {
    this.rosterStatus = options.rosterStatus ?? "participant";
    this.rosterParticipantId = options.rosterParticipantId ?? null;
    this.identityParticipantId = options.identityParticipantId ?? null;
    this.identityExternalUserId = options.identityExternalUserId ??
      (this.identityParticipantId ? telegramUserId : null);
    this.canonicalStatus = options.canonicalStatus ?? "none";
    this.identityVerification = options.identityVerification ?? "verified";
  }

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });

    if (text === "BEGIN") {
      this.transactionState = {
        rosterParticipantId: this.rosterParticipantId,
        identityParticipantId: this.identityParticipantId,
        identityExternalUserId: this.identityExternalUserId,
        canonicalStatus: this.canonicalStatus,
      };
      this.pendingEvents = [];
      return { rowCount: 1, rows: [] };
    }
    if (text === "COMMIT") {
      this.persistedEvents.push(...this.pendingEvents);
      this.pendingEvents = [];
      this.transactionState = null;
      return { rowCount: 1, rows: [] };
    }
    if (text === "ROLLBACK") {
      if (this.transactionState) {
        this.rosterParticipantId = this.transactionState.rosterParticipantId;
        this.identityParticipantId = this.transactionState.identityParticipantId;
        this.identityExternalUserId = this.transactionState.identityExternalUserId;
        this.canonicalStatus = this.transactionState.canonicalStatus;
      }
      this.pendingEvents = [];
      this.transactionState = null;
      return { rowCount: 1, rows: [] };
    }

    if (text.includes("FROM telegram_roster_entries")) {
      if (this.options.missingRoster) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{
          membership_status: this.rosterStatus,
          participant_id: this.rosterParticipantId,
          display_name: "Legacy roster member",
          username: "legacy_member",
          identity_verification: this.identityVerification,
        }],
      };
    }

    if (
      text.includes("participant_registry.membership_status_changed") &&
      text.includes("ORDER BY created_at DESC")
    ) {
      if (this.options.missingEvidence) return { rowCount: 0, rows: [] };
      return {
        rowCount: 1,
        rows: [{
          id: 48,
          participant_id:
            this.options.evidenceEventParticipantId === undefined
              ? evidenceAdminId
              : this.options.evidenceEventParticipantId,
          payload: {
            telegram_user_id:
              this.options.evidenceTelegramUserId ?? telegramUserId,
            old_value: this.options.evidenceOldValue ?? "unknown",
            new_value: this.options.evidenceNewValue ?? "participant",
            changed_by_participant_id:
              this.options.evidenceChangedByParticipantId ?? evidenceAdminId,
          },
          occurred_at: evidenceOccurredAt,
        }],
      };
    }

    if (text.includes("FROM external_identities")) {
      return this.identityParticipantId
        ? {
            rowCount: 1,
            rows: [{
              id: "60000000-0000-0000-0000-000000000001",
              participant_id: this.identityParticipantId,
              external_user_id: this.identityExternalUserId,
            }],
          }
        : { rowCount: 0, rows: [] };
    }

    if (text.includes("FROM participants")) {
      return {
        rowCount: 1,
        rows: [{ membership_status: this.canonicalStatus }],
      };
    }

    if (text.includes("membership_binding_repaired") && text.includes("SELECT id")) {
      return this.options.existingRepairHistory
        ? { rowCount: 1, rows: [{ id: 49, event_type: "membership.joined" }] }
        : { rowCount: 0, rows: [] };
    }

    if (text.includes("INSERT INTO participants")) {
      this.canonicalStatus = "none";
      return { rowCount: 1, rows: [{ id: createdParticipantId }] };
    }

    if (text.includes("UPDATE external_identities")) {
      this.identityParticipantId = this.rosterParticipantId ?? existingParticipantId;
      this.identityExternalUserId = String(values?.[1]);
      return { rowCount: 1, rows: [] };
    }

    if (text.includes("INSERT INTO external_identities")) {
      if (this.options.failIdentityInsert) {
        throw Object.assign(new Error("duplicate Telegram identity"), {
          code: "23505",
        });
      }
      this.identityParticipantId = String(values?.[0]);
      this.identityExternalUserId = String(values?.[2]);
      return { rowCount: 1, rows: [] };
    }

    if (text.includes("UPDATE telegram_roster_entries")) {
      this.rosterParticipantId = String(values?.[1]);
      return { rowCount: 1, rows: [] };
    }

    if (text.includes("UPDATE participants")) {
      this.canonicalStatus = "participant";
      return { rowCount: 1, rows: [] };
    }

    if (text.includes("INSERT INTO events")) {
      const eventType = text.includes("membership_binding_repaired")
        ? "participant_registry.membership_binding_repaired"
        : text.includes("membership.joined")
          ? "membership.joined"
          : "participant.created";
      if (this.options.failEventType === eventType) {
        throw new Error(`${eventType} insert failed`);
      }
      this.pendingEvents.push({
        eventType,
        participantId: String(values?.[0]),
        payload: JSON.parse(String(values?.[1])),
        createdAt: values?.[2] ? String(values[2]) : undefined,
      });
      return { rowCount: 1, rows: [] };
    }

    return { rowCount: 1, rows: [] };
  }

  release() {
    this.released = true;
  }
}

function fakeDatabase(client: FakeRepairClient): ParticipantRegistryDatabase {
  return { async connect() { return client; } };
}

function queryCount(client: FakeRepairClient, fragment: string): number {
  return client.queries.filter(({ text }) => text.includes(fragment)).length;
}

describe("explicit Membership Binding repair", () => {
  it("repairs a legacy participant row without an existing Core subject", async () => {
    const client = new FakeRepairClient();

    const result = await repairMembershipBindingWithDatabase(
      fakeDatabase(client),
      adminParticipantId,
      telegramUserId,
    );

    expect(result).toEqual({
      repaired: true,
      participantId: createdParticipantId,
      evidenceEventId: 48,
    });
    const participantInsert = client.queries.find(({ text }) =>
      text.includes("INSERT INTO participants")
    );
    expect(participantInsert?.text).toContain("VALUES ($1, 'none')");
    expect(client.rosterParticipantId).toBe(createdParticipantId);
    expect(client.identityParticipantId).toBe(createdParticipantId);
    expect(client.canonicalStatus).toBe("participant");
    expect(client.identityVerification).toBe("verified");

    expect(client.persistedEvents.map(({ eventType }) => eventType)).toEqual([
      "participant.created",
      "membership.joined",
      "participant_registry.membership_binding_repaired",
    ]);
    const joined = client.persistedEvents[1];
    expect(joined.createdAt).toBe(evidenceOccurredAt);
    expect(joined.payload).toMatchObject({
      participant_id: createdParticipantId,
      old_status: "unknown",
      new_status: "participant",
      changed_by_participant_id: evidenceAdminId,
      telegram_user_id: telegramUserId,
      source: "participant_registry_repair",
      evidence_event_id: 48,
      occurred_at: evidenceOccurredAt,
    });
    const repair = client.persistedEvents[2];
    expect(repair.participantId).toBe(adminParticipantId);
    expect(repair.payload).toMatchObject({
      evidence_event_id: 48,
      changed_by_participant_id: adminParticipantId,
      participant_id: createdParticipantId,
      before: {
        roster_participant_id: null,
        identity_participant_id: null,
        canonical_membership_status: "missing",
      },
      after: {
        roster_participant_id: createdParticipantId,
        identity_participant_id: createdParticipantId,
        canonical_membership_status: "participant",
      },
    });
  });

  it("promotes the same Participant created as none by OIDC", async () => {
    const client = new FakeRepairClient({
      rosterParticipantId: existingParticipantId,
      identityParticipantId: existingParticipantId,
      canonicalStatus: "none",
    });

    const result = await repairMembershipBindingWithDatabase(
      fakeDatabase(client),
      adminParticipantId,
      telegramUserId,
    );

    expect(result.participantId).toBe(existingParticipantId);
    expect(client.canonicalStatus).toBe("participant");
    expect(queryCount(client, "INSERT INTO participants")).toBe(0);
    expect(queryCount(client, "INSERT INTO external_identities")).toBe(0);
  });

  it("uses an existing Telegram ExternalIdentity and links its Participant", async () => {
    const client = new FakeRepairClient({
      identityParticipantId: existingParticipantId,
      canonicalStatus: "none",
    });

    await repairMembershipBindingWithDatabase(
      fakeDatabase(client),
      adminParticipantId,
      telegramUserId,
    );

    expect(client.rosterParticipantId).toBe(existingParticipantId);
    expect(client.canonicalStatus).toBe("participant");
    expect(queryCount(client, "INSERT INTO participants")).toBe(0);
    expect(queryCount(client, "INSERT INTO external_identities")).toBe(0);
  });

  it("creates a missing identity for an already linked Participant", async () => {
    const client = new FakeRepairClient({
      rosterParticipantId: existingParticipantId,
      canonicalStatus: "participant",
    });

    await repairMembershipBindingWithDatabase(
      fakeDatabase(client),
      adminParticipantId,
      telegramUserId,
    );

    expect(client.identityParticipantId).toBe(existingParticipantId);
    expect(queryCount(client, "INSERT INTO external_identities")).toBe(1);
    expect(queryCount(client, "INSERT INTO participants")).toBe(0);
  });

  it.each([
    ["missing", { missingEvidence: true }],
    ["wrong old state", { evidenceOldValue: "left" }],
    ["contradictory latest state", { evidenceNewValue: "left" }],
    ["wrong Telegram user", { evidenceTelegramUserId: "999" }],
    ["spoofed actor", { evidenceChangedByParticipantId: adminParticipantId }],
  ])("rejects %s membership evidence", async (_label, options) => {
    const client = new FakeRepairClient(options);

    await expect(
      repairMembershipBindingWithDatabase(
        fakeDatabase(client),
        adminParticipantId,
        telegramUserId,
      ),
    ).rejects.toThrow(/evidence/i);
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(client.persistedEvents).toEqual([]);
  });

  it("rejects conflicting roster and ExternalIdentity links", async () => {
    const client = new FakeRepairClient({
      rosterParticipantId: existingParticipantId,
      identityParticipantId: conflictingParticipantId,
      canonicalStatus: "none",
    });

    await expect(
      repairMembershipBindingWithDatabase(
        fakeDatabase(client),
        adminParticipantId,
        telegramUserId,
      ),
    ).rejects.toThrow("but Telegram identity belongs to Participant");
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
  });

  it.each(["left", "excluded"])(
    "does not overwrite canonical %s",
    async (canonicalStatus) => {
      const client = new FakeRepairClient({
        rosterParticipantId: existingParticipantId,
        identityParticipantId: existingParticipantId,
        canonicalStatus,
      });

      await expect(
        repairMembershipBindingWithDatabase(
          fakeDatabase(client),
          adminParticipantId,
          telegramUserId,
        ),
      ).rejects.toThrow(`cannot overwrite canonical status ${canonicalStatus}`);
      expect(client.canonicalStatus).toBe(canonicalStatus);
      expect(client.persistedEvents).toEqual([]);
    },
  );

  it("is idempotent for an already correct binding", async () => {
    const client = new FakeRepairClient({
      rosterParticipantId: existingParticipantId,
      identityParticipantId: existingParticipantId,
      canonicalStatus: "participant",
    });

    const result = await repairMembershipBindingWithDatabase(
      fakeDatabase(client),
      adminParticipantId,
      telegramUserId,
    );

    expect(result).toEqual({
      repaired: false,
      participantId: existingParticipantId,
      evidenceEventId: 48,
    });
    expect(client.persistedEvents).toEqual([]);
    expect(queryCount(client, "INSERT INTO participants")).toBe(0);
    expect(queryCount(client, "INSERT INTO external_identities")).toBe(0);
  });

  it("rolls back the complete repair when audit insertion fails", async () => {
    const client = new FakeRepairClient({
      failEventType: "participant_registry.membership_binding_repaired",
    });

    await expect(
      repairMembershipBindingWithDatabase(
        fakeDatabase(client),
        adminParticipantId,
        telegramUserId,
      ),
    ).rejects.toThrow("membership_binding_repaired insert failed");
    expect(client.rosterParticipantId).toBeNull();
    expect(client.identityParticipantId).toBeNull();
    expect(client.canonicalStatus).toBe("none");
    expect(client.persistedEvents).toEqual([]);
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
  });

  it("rolls back a newly created Participant on a concurrent identity conflict", async () => {
    const client = new FakeRepairClient({ failIdentityInsert: true });

    await expect(
      repairMembershipBindingWithDatabase(
        fakeDatabase(client),
        adminParticipantId,
        telegramUserId,
      ),
    ).rejects.toMatchObject({ code: "23505" });
    expect(client.rosterParticipantId).toBeNull();
    expect(client.identityParticipantId).toBeNull();
    expect(client.canonicalStatus).toBe("none");
    expect(client.persistedEvents).toEqual([]);
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
  });
});
