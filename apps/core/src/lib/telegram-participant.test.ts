import { describe, expect, it, vi } from "vitest";
import {
  findOrCreateParticipantByTelegramId,
  TelegramParticipantIdentityConflictError,
} from "./telegram-participant";

const existingParticipantId = "10000000-0000-4000-8000-000000000001";
const otherParticipantId = "20000000-0000-4000-8000-000000000002";

describe("Participant lookup by Telegram user ID", () => {
  it("reuses an existing Telegram identity without creating a Participant", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM telegram_roster_entries")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM external_identities")) return { rowCount: 1, rows: [
        { id: "identity-id", participant_id: existingParticipantId,
          provider_subject: "oidc-subject", external_user_id: "42" },
      ] };
      return { rowCount: 1, rows: [] };
    });

    expect(await findOrCreateParticipantByTelegramId({ query, release() {} }, "42"))
      .toBe(existingParticipantId);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO participants"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO external_identities"))).toBe(false);
  });

  it("reuses a Participant already linked to the same Telegram ID in the roster", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM telegram_roster_entries")) return {
        rowCount: 1, rows: [{ participant_id: existingParticipantId }],
      };
      if (sql.includes("FROM external_identities")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    });

    expect(await findOrCreateParticipantByTelegramId({ query, release() {} }, "42"))
      .toBe(existingParticipantId);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO participants"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO external_identities"))).toBe(true);
  });

  it("rejects a roster and identity conflict without merging Participants", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM telegram_roster_entries")) return {
        rowCount: 1, rows: [{ participant_id: existingParticipantId }],
      };
      if (sql.includes("FROM external_identities")) return { rowCount: 1, rows: [
        { id: "identity-id", participant_id: otherParticipantId,
          provider_subject: "oidc-subject", external_user_id: "42" },
      ] };
      return { rowCount: 1, rows: [] };
    });

    await expect(findOrCreateParticipantByTelegramId({ query, release() {} }, "42"))
      .rejects.toBeInstanceOf(TelegramParticipantIdentityConflictError);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });

  it("rejects a Participant whose Telegram identity belongs to another user ID", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM telegram_roster_entries")) return {
        rowCount: 1, rows: [{ participant_id: existingParticipantId }],
      };
      if (sql.includes("FROM external_identities")) return { rowCount: 1, rows: [
        { id: "identity-id", participant_id: existingParticipantId,
          provider_subject: "oidc-subject", external_user_id: "99" },
      ] };
      return { rowCount: 1, rows: [] };
    });

    await expect(findOrCreateParticipantByTelegramId({ query, release() {} }, "42"))
      .rejects.toBeInstanceOf(TelegramParticipantIdentityConflictError);
  });
});
