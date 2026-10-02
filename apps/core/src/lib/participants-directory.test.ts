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
              verification_points: 2, positive_count: 3,
            },
            {
              participant_id: "20000000-0000-4000-8000-000000000002",
              display_name: "Борис",
              telegram_username: null,
              verification_points: 0, positive_count: 0,
            },
          ],
        };
      },
    }, "  @alice  ");

    expect(queries).toHaveLength(1);
    expect(queries[0].values).toEqual(["alice", "", null, "", "", ""]);
    expect(queries[0].text).toContain("WITH RECURSIVE verified");
    expect(queries[0].text).toContain("JOIN verified verifier");
    expect(queries[0].text).toContain("incoming.revoked_at IS NULL");
    expect(queries[0].text).toContain("reputation.signal_type = 'positive'");
    expect(queries[0].text).toContain("FROM participants participant");
    expect(queries[0].text).toContain("LEFT JOIN external_identities telegram");
    expect(queries[0].text).toContain("login.event_type = 'participant.logged_in'");
    expect(queries[0].text).not.toContain("telegram_roster_entries");
    expect(queries[0].text).not.toContain("phone_number");
    expect(entries).toEqual([
      {
        participantId: "10000000-0000-4000-8000-000000000001",
        displayName: "Алиса",
        telegramUsername: "alice",
        telegramBio: null,
        avatarUrl: null,
        hasTelegramPhoto: false,
        verificationPoints: 2, positiveCount: 3,
        residence: null,
      },
      {
        participantId: "20000000-0000-4000-8000-000000000002",
        displayName: "Борис",
        telegramUsername: null,
        telegramBio: null,
        avatarUrl: null,
        hasTelegramPhoto: false,
        verificationPoints: 0, positiveCount: 0,
        residence: null,
      },
    ]);
  });

  it("admits forum members or Core visitors without requiring both", async () => {
    let sql = "";
    await listParticipantsDirectoryWithDatabase({
      async query(text) {
        sql = text;
        return { rows: [] };
      },
    });

    expect(sql).toMatch(/WHERE \(\s*EXISTS \(\s*SELECT 1 FROM participant_forum_onboarding forum\s+WHERE forum.participant_id = participant.id\s+AND forum.forum_status = 'joined'\s*\)\s*OR EXISTS \(\s*SELECT 1 FROM events login\s+WHERE login.participant_id = participant.id\s+AND login.event_type = 'participant.logged_in'\s*\)\s*\)/);
  });

  it("keeps the OIDC avatar visible when Bot API reports no photo", async () => {
    const entries = await listParticipantsDirectoryWithDatabase({
      async query() {
        return { rows: [{
          participant_id: "10000000-0000-4000-8000-000000000001",
          display_name: "Алиса",
          avatar_url: "https://cdn.example/avatar.jpg",
          telegram_photo_file_id: "old-photo",
          telegram_photo_count: "0",
          verification_points: 0, positive_count: 0,
        }] };
      },
    });
    expect(entries[0]).toMatchObject({
      avatarUrl: "https://cdn.example/avatar.jpg",
      hasTelegramPhoto: false,
    });
  });

  it("filters by a normalized interest visible to the viewer, including the viewer's own interest", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const viewerParticipantId = "10000000-0000-4000-8000-000000000001";
    await listParticipantsDirectoryWithDatabase({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [] };
      },
    }, "", { interest: "  История  ", viewerParticipantId });

    expect(queries[0].values).toEqual(["", "история", viewerParticipantId, "", "", ""]);
    expect(queries[0].text).toContain("interest.normalized_label = $2");
    expect(queries[0].text).toContain("interest.visibility IN ('public', 'members')");
    expect(queries[0].text).toContain("interest.participant_id = $3::uuid");
    expect(queries[0].text).toContain("login.event_type = 'participant.logged_in'");
  });

  it("aggregates a complete residence for visible profiles", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const residence = { name: "Казань", type: "город", country: "Россия" };
    const entries = await listParticipantsDirectoryWithDatabase({
      async query(text, values) {
        queries.push({ text, values });
        return { rows: [{
          participant_id: "10000000-0000-4000-8000-000000000001",
          display_name: "Анна", verification_points: 0, positive_count: 0,
          residence_name: "Казань", residence_type: "город", residence_country: "Россия",
        }] };
      },
    }, "", { residence });
    expect(queries[0].values).toEqual(["", "", null, "казань", "город", "россия"]);
    expect(queries[0].text).toContain("lower(participant.residence_name) = $4");
    expect(queries[0].text).toContain("lower(participant.residence_type) = $5");
    expect(queries[0].text).toContain("lower(participant.residence_country) = $6");
    expect(queries[0].text).toContain("login.event_type = 'participant.logged_in'");
    expect(entries[0].residence).toEqual(residence);
  });

  it("orders verification and reputation leaders with a stable name tie-break", async () => {
    const orders: string[] = [];
    const database = { async query(text: string) { orders.push(text); return { rows: [] }; } };
    await listParticipantsDirectoryWithDatabase(database, "", { sort: "verification" });
    await listParticipantsDirectoryWithDatabase(database, "", { sort: "reputation" });
    await listParticipantsDirectoryWithDatabase(database);
    expect(orders[0]).toContain("ORDER BY verification_points DESC, lower(participant.display_name), participant.id");
    expect(orders[1]).toContain("ORDER BY positive_count DESC, lower(participant.display_name), participant.id");
    expect(orders[2]).toContain("ORDER BY lower(participant.display_name), participant.id");
  });
});
