import { describe, expect, it } from "vitest";
import { safeAuthReturnPath } from "./auth-return";

const id = "10000000-0000-4000-8000-000000000001";

describe("safeAuthReturnPath", () => {
  it("allows /need and canonical Signal card paths only", () => {
    expect(safeAuthReturnPath("/need")).toBe("/need");
    expect(safeAuthReturnPath(`/exchange/${id}`)).toBe(`/exchange/${id}`);
  });
  it.each([null, undefined, "", "/", "/profile", "//evil.example", "https://evil.example", `/exchange/${id}/x`,
    `/exchange/${id}?x=1`, "/exchange/not-a-uuid", `/exchange/${id}\n`, `//exchange/${id}`])("rejects %s", (value) => {
    expect(safeAuthReturnPath(value)).toBeNull();
  });
});
