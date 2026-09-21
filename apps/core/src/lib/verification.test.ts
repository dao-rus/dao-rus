import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { canCreateProposal } from "./eligibility";
import {
  addVerificationRootWithDatabase,
  createVerificationAttestationWithDatabase,
  deriveVerificationGraph,
  getVerificationProfileWithDatabase,
  revokeVerificationAttestationWithDatabase,
  VerificationEligibilityError,
  VerificationValidationError,
  type VerificationDatabase,
  type VerificationDatabaseClient,
} from "./verification";

const root = "10000000-0000-4000-8000-000000000001";
const subjectA = "20000000-0000-4000-8000-000000000001";
const subjectB = "30000000-0000-4000-8000-000000000001";
const subjectC = "40000000-0000-4000-8000-000000000001";
const attestationId = "50000000-0000-4000-8000-000000000001";
const happenedAt = "2026-09-20T10:00:00.000Z";

class FakeClient implements VerificationDatabaseClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;

  constructor(
    private readonly options: {
      verifierVerified?: boolean;
      existingAttestation?: boolean;
      rootAlreadyExists?: boolean;
    } = {},
  ) {}

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });
    if (text.includes("SELECT id FROM participants")) {
      return { rowCount: 1, rows: [{ id: values?.[0] }] };
    }
    if (text.includes("AS is_verified") && !text.includes("FROM participants subject")) {
      return {
        rowCount: 1,
        rows: [{ is_verified: this.options.verifierVerified ?? true }],
      };
    }
    if (text.includes("FROM participants subject")) {
      return {
        rowCount: 1,
        rows: [{
          subject_id: subjectB,
          display_name: "Subject B",
          has_logged_in: false,
          membership_status: "none",
          is_root: false,
          is_verified: true,
          verification_points: 2,
          viewer_is_verified: true,
          viewer_attestation_id: attestationId,
        }],
      };
    }
    if (text.includes("FROM verification_attestations") && text.includes("FOR UPDATE")) {
      return this.options.existingAttestation
        ? { rowCount: 1, rows: [{ id: attestationId }] }
        : { rowCount: 0, rows: [] };
    }
    if (text.includes("INSERT INTO verification_attestations")) {
      return {
        rowCount: 1,
        rows: [{ id: attestationId, created_at: happenedAt }],
      };
    }
    if (text.includes("UPDATE verification_attestations")) {
      return { rowCount: 1, rows: [{ revoked_at: happenedAt }] };
    }
    if (text.includes("INSERT INTO verification_roots")) {
      return this.options.rootAlreadyExists
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [{ created_at: happenedAt }] };
    }
    return { rowCount: 1, rows: [] };
  }

  release() {
    this.released = true;
  }
}

function database(client: FakeClient): VerificationDatabase {
  return { async connect() { return client; } };
}

describe("Human Verification graph", () => {
  it("verifies roots and propagates root -> A -> B", () => {
    const result = deriveVerificationGraph([root], [
      { verifierSubjectId: root, subjectId: subjectA },
      { verifierSubjectId: subjectA, subjectId: subjectB },
    ]);

    expect([...result.verifiedSubjectIds]).toEqual([root, subjectA, subjectB]);
    expect(result.pointsBySubjectId.get(root) ?? 0).toBe(0);
    expect(result.pointsBySubjectId.get(subjectA)).toBe(1);
    expect(result.pointsBySubjectId.get(subjectB)).toBe(1);
  });

  it("counts several active incoming attestations from verified subjects", () => {
    const result = deriveVerificationGraph([root], [
      { verifierSubjectId: root, subjectId: subjectA },
      { verifierSubjectId: root, subjectId: subjectB },
      { verifierSubjectId: subjectA, subjectId: subjectB },
    ]);

    expect(result.verifiedSubjectIds.has(subjectB)).toBe(true);
    expect(result.pointsBySubjectId.get(subjectB)).toBe(2);
  });

  it("does not verify a cycle disconnected from every root", () => {
    const result = deriveVerificationGraph([root], [
      { verifierSubjectId: subjectB, subjectId: subjectC },
      { verifierSubjectId: subjectC, subjectId: subjectB },
    ]);

    expect(result.verifiedSubjectIds.has(subjectB)).toBe(false);
    expect(result.verifiedSubjectIds.has(subjectC)).toBe(false);
    expect(result.pointsBySubjectId.get(subjectB) ?? 0).toBe(0);
  });

  it("excludes revoked attestations and cascades derived verification", () => {
    const result = deriveVerificationGraph([root], [
      { verifierSubjectId: root, subjectId: subjectA, revokedAt: new Date() },
      { verifierSubjectId: subjectA, subjectId: subjectB },
    ]);

    expect([...result.verifiedSubjectIds]).toEqual([root]);
    expect(result.pointsBySubjectId.size).toBe(0);
  });

  it("keeps verification independent from membership eligibility", () => {
    const graph = deriveVerificationGraph([root], []);
    expect(graph.verifiedSubjectIds.has(root)).toBe(true);
    expect(canCreateProposal({ membershipStatus: "none" })).toBe(false);
    expect(canCreateProposal({ membershipStatus: "participant" })).toBe(true);
  });
});

describe("VerificationAttestation persistence", () => {
  it("rejects self-verification before opening a transaction", async () => {
    let connected = false;
    const db: VerificationDatabase = {
      async connect() {
        connected = true;
        return new FakeClient();
      },
    };
    await expect(
      createVerificationAttestationWithDatabase(db, subjectA, subjectA),
    ).rejects.toBeInstanceOf(VerificationValidationError);
    expect(connected).toBe(false);
  });

  it("rejects an attestation from an unverified subject", async () => {
    const client = new FakeClient({ verifierVerified: false });
    await expect(
      createVerificationAttestationWithDatabase(database(client), subjectA, subjectB),
    ).rejects.toBeInstanceOf(VerificationEligibilityError);
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
  });

  it("creates an attestation and its audit event atomically", async () => {
    const client = new FakeClient();
    const result = await createVerificationAttestationWithDatabase(
      database(client),
      subjectA,
      subjectB,
    );

    expect(result).toEqual({ changed: true, attestationId });
    const event = client.queries.find(({ text }) =>
      text.includes("verification.attestation_created")
    );
    expect(event?.values?.[0]).toBe(subjectA);
    expect(JSON.parse(String(event?.values?.[1]))).toMatchObject({
      attestation_id: attestationId,
      verifier_subject_id: subjectA,
      subject_id: subjectB,
    });
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
  });

  it("does not create a duplicate active A -> B attestation or event", async () => {
    const client = new FakeClient({ existingAttestation: true });
    const result = await createVerificationAttestationWithDatabase(
      database(client),
      subjectA,
      subjectB,
    );

    expect(result).toEqual({ changed: false, attestationId });
    expect(client.queries.some(({ text }) =>
      text.includes("INSERT INTO verification_attestations")
    )).toBe(false);
    expect(client.queries.some(({ text }) => text.includes("INSERT INTO events"))).toBe(false);
  });

  it("revokes rather than deletes an active attestation and writes an event", async () => {
    const client = new FakeClient({ existingAttestation: true });
    const result = await revokeVerificationAttestationWithDatabase(
      database(client),
      subjectA,
      subjectB,
    );

    expect(result).toEqual({ changed: true, attestationId });
    expect(client.queries.some(({ text }) => text.includes("DELETE"))).toBe(false);
    expect(client.queries.some(({ text }) =>
      text.includes("verification.attestation_revoked")
    )).toBe(true);
  });

  it("adds an explicit root with audit history", async () => {
    const client = new FakeClient();
    const result = await addVerificationRootWithDatabase(
      database(client),
      root,
      subjectA,
    );

    expect(result.changed).toBe(true);
    expect(client.queries.some(({ text }) => text.includes("verification.root_added"))).toBe(true);
  });

  it("queries verification and points through recursive reachability", async () => {
    const client = new FakeClient();
    const profile = await getVerificationProfileWithDatabase(client, subjectB, subjectA);
    expect(profile).toMatchObject({
      subjectId: subjectB,
      hasLoggedIn: false,
      isVerified: true,
      verificationPoints: 2,
      viewerAttestationId: attestationId,
    });
    expect(client.queries[0].text).toContain("WITH RECURSIVE verified");
    expect(client.queries[0].text).toContain("incoming.revoked_at IS NULL");
    expect(client.queries[0].text).toContain("login.event_type = 'participant.logged_in'");
  });
});

describe("009 verification schema", () => {
  it("stores roots and revocable attestations without touching legacy verification", async () => {
    const migration = await readFile(
      new URL("../../migrations/009_verification_attestations.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("CREATE TABLE verification_roots");
    expect(migration).toContain("CREATE TABLE verification_attestations");
    expect(migration).toContain("CHECK (verifier_subject_id <> subject_id)");
    expect(migration).toContain("WHERE revoked_at IS NULL");
    expect(migration).not.toContain("telegram_roster_entries");
    expect(migration).not.toContain("identity_verification");
  });
});
