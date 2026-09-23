import { describe, expect, it } from "vitest";
import { claimDarusRewardAnimation } from "./darus-reward-celebration";

describe("DARUS reward animation", () => {
  it("plays once per ledger entry in a browser tab", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    expect(claimDarusRewardAnimation("entry-a", storage)).toBe(true);
    expect(claimDarusRewardAnimation("entry-a", storage)).toBe(false);
    expect(claimDarusRewardAnimation("entry-b", storage)).toBe(true);
  });
});
