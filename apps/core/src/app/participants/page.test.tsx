import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  listParticipantsDirectory: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({
  getCurrentParticipant: mocks.getCurrentParticipant,
}));
vi.mock("@/lib/participants-directory", () => ({
  listParticipantsDirectory: mocks.listParticipantsDirectory,
}));

import ParticipantsPage from "./page";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function hrefs(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(hrefs);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode; href?: string };
  return [...(props.href ? [props.href] : []), ...hrefs(props.children)];
}

describe("/participants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((destination: string) => {
      throw new Error(`redirect:${destination}`);
    });
  });

  it("requires an authenticated Participant", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);

    await expect(ParticipantsPage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("redirect:/");
    expect(mocks.listParticipantsDirectory).not.toHaveBeenCalled();
  });

  it("shows only public Core profile fields and forwards search", async () => {
    const participantId = "10000000-0000-4000-8000-000000000001";
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([
      {
        participantId,
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

    const page = await ParticipantsPage({
      searchParams: Promise.resolve({ q: "alice" }),
    });
    const text = textContent(page);

    expect(mocks.listParticipantsDirectory).toHaveBeenCalledWith("alice");
    expect(text).toContain("Алиса");
    expect(text).toContain("@alice");
    expect(text).toContain("Личность подтверждена");
    expect(text).toContain("Пока не подтверждена");
    expect(text).not.toContain(participantId);
    expect(text).not.toContain("Telegram ID");
    expect(text).not.toContain("Статус в ДАО");
    expect(text).not.toContain("Последний раз в Telegram");
    expect(hrefs(page)).toContain(`/profile/${participantId}`);
    expect(hrefs(page)).not.toContain("/admin/participants");
  });
});
