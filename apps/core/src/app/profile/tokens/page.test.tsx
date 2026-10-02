import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  getDarusBalance: vi.fn(),
  getDarusHistory: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/tokenization", () => ({
  getDarusBalance: mocks.getDarusBalance,
  getDarusHistory: mocks.getDarusHistory,
}));
vi.mock("@/components/local-date-time", () => ({ LocalDateTime: () => null }));

import TokensPage from "./page";

function content(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(content).join(" ");
  if (!isValidElement(node)) return "";
  return content((node.props as { children?: ReactNode }).children);
}

describe("/profile/tokens", () => {
  it("reads only the current participant ledger and shows the applied tariff", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "owner" });
    mocks.getDarusBalance.mockResolvedValue("0.100000");
    mocks.getDarusHistory.mockResolvedValue([{
      id: "entry", amount: "0.100000", subjectName: "Анна", sourceType: "verification_created",
      createdAt: new Date("2026-09-21T00:00:00Z"),
      tariff: "0.100000", rewardRuleVersion: 1,
    }]);
    const page = await TokensPage();
    expect(mocks.getDarusBalance).toHaveBeenCalledWith("owner");
    expect(mocks.getDarusHistory).toHaveBeenCalledWith("owner");
    expect(content(page)).toContain("Подтверждение личности:");
    expect(content(page)).toContain("Анна");
    expect(content(page)).toContain("версия");
  });
});
