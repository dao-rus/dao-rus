import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("retired manual communication reputation API", () => {
  it("does not accept manual scores after reactions became the sole source", async () => {
    const response = await POST();
    expect(response.status).toBe(410);
    expect(await response.text()).toContain("recorded by the Telegram hub bot");
  });
});
