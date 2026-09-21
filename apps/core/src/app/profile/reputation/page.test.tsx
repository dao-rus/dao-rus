import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentParticipant: vi.fn(), getReputationSummary: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/reputation", () => ({ getReputationSummary: mocks.getReputationSummary }));
import ReputationPage from "./page";

function content(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(content).join(" ");
  if (!isValidElement(node)) return "";
  return content((node.props as { children?: ReactNode }).children);
}

describe("/profile/reputation", () => {
  it("shows the current participant's positive signals without a score or DARUS", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "owner" });
    mocks.getReputationSummary.mockResolvedValue({ positiveCount: 4, viewerSignal: null });
    const page = await ReputationPage();
    expect(mocks.getReputationSummary).toHaveBeenCalledWith("owner", "owner");
    expect(content(page)).toMatch(/Хороший опыт взаимодействия:\s+4/);
    expect(content(page)).toContain("не является единым рейтингом");
    expect(content(page)).not.toContain("DARUS");
  });
});
