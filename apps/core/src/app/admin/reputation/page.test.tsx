import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(), hasPrototypeAdminAccess: vi.fn(), getReputationHistory: vi.fn(), redirect: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess }));
vi.mock("@/lib/reputation", () => ({ getReputationHistory: mocks.getReputationHistory }));
vi.mock("@/components/local-date-time", () => ({ LocalDateTime: () => null }));
import AdminReputationPage from "./page";

function content(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(content).join(" ");
  if (!isValidElement(node)) return "";
  return content((node.props as { children?: ReactNode }).children);
}

describe("/admin/reputation", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shows actors, subjects, types, and state only to admins", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    mocks.getReputationHistory.mockResolvedValue([{
      id: "signal", actorId: "actor", actorName: "Анна", subjectId: "subject", subjectName: "Борис",
      signalType: "quality_flag", createdAt: new Date("2026-09-21T00:00:00Z"), revokedAt: null,
    }]);
    const page = await AdminReputationPage();
    expect(content(page)).toMatch(/Анна\s+→\s+Борис/);
    expect(content(page)).toMatch(/Есть проблема\s+·\s+активен/);
    expect(mocks.getReputationHistory).toHaveBeenCalledOnce();
  });

  it("redirects ordinary participants before reading confidential history", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "ordinary" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);
    mocks.redirect.mockImplementation(() => { throw new Error("redirect"); });
    await expect(AdminReputationPage()).rejects.toThrow("redirect");
    expect(mocks.getReputationHistory).not.toHaveBeenCalled();
  });
});
