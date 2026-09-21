import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  readInterfaceTexts: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/interface-texts", () => ({ readInterfaceTexts: mocks.readInterfaceTexts }));
vi.mock("@/lib/config", () => ({
  isTelegramConfigured: () => true,
  devAuthEnabled: () => false,
}));

import Home from "./page";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

describe("home interface texts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readInterfaceTexts.mockResolvedValue({ values: {
      "home.eyebrow": "Своя надпись",
      "home.title": "Свой заголовок",
      "home.lead": "Свой основной текст",
      "home.login_button": "Свой вход",
      "home.profile_button": "Свой профиль",
    } });
  });

  it("shows overridden texts to a visitor", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    const page = await Home({ searchParams: Promise.resolve({}) });
    const text = textContent(page);
    expect(text).toContain("Своя надпись");
    expect(text).toContain("Свой заголовок");
    expect(text).toContain("Свой основной текст");
    expect(text).toContain("Свой вход");
  });

  it("shows the overridden profile button after login", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "participant" });
    const page = await Home({ searchParams: Promise.resolve({}) });
    expect(textContent(page)).toContain("Свой профиль");
  });
});
