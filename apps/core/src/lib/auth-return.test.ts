import { describe, expect, it } from "vitest";
import { safeAuthReturnPath } from "./auth-return";

const id = "10000000-0000-4000-8000-000000000001";

describe("safeAuthReturnPath", () => {
  it("allows fixed public return paths and canonical card paths", () => {
    expect(safeAuthReturnPath("/slovotvor")).toBe("/slovotvor");
    expect(safeAuthReturnPath("/slovotvor/kraynesrok")).toBe("/slovotvor/kraynesrok");
    expect(safeAuthReturnPath("/need")).toBe("/need");
    expect(safeAuthReturnPath(`/exchange/${id}`)).toBe(`/exchange/${id}`);
    expect(safeAuthReturnPath(`/award-offers/${id}`)).toBe(`/award-offers/${id}`);
    expect(safeAuthReturnPath("/awards/first-wave")).toBe("/awards/first-wave");
  });
  it.each(["/awards/", "/awards/First-Wave", "/awards/a--b", "/awards/-a", "/awards/a/b", "/awards/a?next=https://evil.example",
    "/awards/a\n", "//awards/a", "/awards/a/../../profile", `/awards/${"a".repeat(101)}`])("rejects award path %s", (value) => {
    expect(safeAuthReturnPath(value)).toBeNull();
  });
  it.each([null, undefined, "", "/", "/profile", "//evil.example", "https://evil.example", "/slovotvor/Bad Slug", "/slovotvor/a/b", `/exchange/${id}/x`,
    `/exchange/${id}?x=1`, "/exchange/not-a-uuid", `/exchange/${id}\n`, `//exchange/${id}`,
    `/award-offers/${id}/../../profile`, `/award-offers/${id}?next=https://evil.example`, `/award-offers/${id}\n`, `//award-offers/${id}`])("rejects %s", (value) => {
    expect(safeAuthReturnPath(value)).toBeNull();
  });
});
