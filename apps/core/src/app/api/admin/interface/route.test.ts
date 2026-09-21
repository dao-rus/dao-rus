import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  saveInterfaceTexts: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  appBaseUrl: () => "http://localhost:3000",
  hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess,
}));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/interface-texts", () => ({
  InterfaceTextValidationError: class InterfaceTextValidationError extends Error {},
  parseInterfaceTextForm: (form: FormData) => ({
    "home.eyebrow": form.get("home.eyebrow"),
    "home.title": form.get("home.title"),
    "home.lead": form.get("home.lead"),
    "home.login_button": form.get("home.login_button"),
    "home.profile_button": form.get("home.profile_button"),
  }),
  saveInterfaceTexts: mocks.saveInterfaceTexts,
}));

import { POST } from "./route";

function interfaceRequest(fields: Record<string, string>) {
  return new Request("http://localhost:3000/api/admin/interface", {
    method: "POST",
    body: new URLSearchParams(fields),
  }) as Parameters<typeof POST>[0];
}

const fields = {
  "home.eyebrow": "Ядро",
  "home.title": "Новый заголовок",
  "home.lead": "Основной текст",
  "home.login_button": "Войти через Telegram",
  "home.profile_button": "Открыть профиль",
};

describe("POST /api/admin/interface", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an ordinary participant without saving", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "ordinary" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);

    const response = await POST(interfaceRequest(fields));

    expect(response.status).toBe(403);
    expect(mocks.saveInterfaceTexts).not.toHaveBeenCalled();
  });

  it("uses the admin identity from the server session", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "real-admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    mocks.saveInterfaceTexts.mockResolvedValue(["home.title"]);

    const response = await POST(interfaceRequest({ ...fields, actor_id: "forged" }));

    expect(mocks.saveInterfaceTexts).toHaveBeenCalledWith(
      "real-admin",
      expect.objectContaining({ "home.title": "Новый заголовок" }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location"))
      .toBe("http://localhost:3000/admin/interface?interface_update=updated");
  });
});
