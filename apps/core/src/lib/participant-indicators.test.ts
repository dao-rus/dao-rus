import { describe, expect, it } from "vitest";
import { getParticipantIndicatorsWithDatabase } from "./participant-indicators";

describe("participant indicators", () => {
  it("reads current verification weight and positive reputation count in one query", async () => {
    const id = "10000000-0000-4000-8000-000000000001";
    let sql = "";
    const values: unknown[][] = [];
    const result = await getParticipantIndicatorsWithDatabase({
      async query(text, args) {
        sql = text;
        values.push(args ?? []);
        return { rows: [{ id, verification_points: 2, positive_count: 7 }] };
      },
    }, [id]);
    expect(result.get(id)).toEqual({ verificationPoints: 2, positiveCount: 7 });
    expect(values).toEqual([[[id]]]);
    expect(sql).toContain("JOIN verified v");
    expect(sql).toContain("a.revoked_at IS NULL");
    expect(sql).toContain("r.signal_type = 'positive' AND r.revoked_at IS NULL");
  });
});
