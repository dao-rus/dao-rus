import { describe, expect, it } from "vitest";
import { listParticipantsDirectoryWithDatabase } from "./participants-directory";

describe("participants directory", () => {
  it("lists Core Participants with canonical Human Verification in one query", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const entries = await listParticipantsDirectoryWithDatabase({
      async query(text, values) {
        queries.push({ text, values });
        return {
          rows: [
            {
              participant_id: "10000000-0000-4000-8000-000000000001",
              display_name: "Алиса",
              telegram_username: "alice",
              is_verified: true,
            },
            {
              participant_id: "20000000-0000-4000-8000-000000000002",
              display_name: "Борис",
              telegram_username: null,
              is_verified: false,
            },
          ],
        };
      },
    }, "  @alice  ");

    expect(queries).toHaveLength(1);
    expect(queries[0].values).toEqual(["alice"]);
    expect(queries[0].text).toContain("WITH RECURSIVE verified");
    expect(queries[0].text).toContain("FROM participants participant");
    expect(queries[0].text).toContain("LEFT JOIN external_identities telegram");
    expect(queries[0].text).not.toContain("telegram_roster_entries");
    expect(entries).toEqual([
      {
        participantId: "10000000-0000-4000-8000-000000000001",
        displayName: "Алиса",
        telegramUsername: "alice",
        isVerified: true,
      },
      {
        participantId: "20000000-0000-4000-8000-000000000002",
        displayName: "Борис",
        telegramUsername: null,
        isVerified: false,
      },
    ]);
  });
});
