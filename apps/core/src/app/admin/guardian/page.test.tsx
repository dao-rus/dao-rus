import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), audience: vi.fn(), campaigns: vi.fn(), result: vi.fn(), departures: vi.fn(), arrivals: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.session }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: mocks.admin }));
vi.mock("../../../lib/guardian-audience", async original => ({ ...(await original<typeof import("../../../lib/guardian-audience")>()), getGuardianAudience: mocks.audience }));
vi.mock("../../../lib/guardian-campaign", async original => ({ ...(await original<typeof import("../../../lib/guardian-campaign")>()), getGuardianOneShotCampaigns: mocks.campaigns, getGuardianCampaignById: mocks.result }));
vi.mock("../../../lib/guardian-arrivals", () => ({ getGuardianArrivalSummary: mocks.arrivals }));
vi.mock("../../../lib/guardian-departures", () => ({ getGuardianDepartureSummary: mocks.departures }));
vi.mock("../../../lib/interface-texts", async original => { const actual = await original<typeof import("../../../lib/interface-texts")>();
  return { ...actual, readInterfaceTexts: async () => ({ values: Object.fromEntries(actual.interfaceTextFields.map(f => [f.key, f.defaultValue])), overrides: {} }) }; });
import Page from "./page";
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : "";
}
function nodes(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>; return [{ type: node.type, props }, ...nodes(props.children as ReactNode)];
}
describe("unified Guardian page", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ id: "admin" }); mocks.admin.mockReturnValue(true);
    mocks.redirect.mockImplementation((path: string) => { throw new Error("redirect:" + path); });
    mocks.audience.mockResolvedValue({ missingCity: [{}], missingInterests: [{},{}], missingBio: [{}], neverLoggedIn: [{}], unverified: [{}], cities: [], interests: [], audience: [] });
    mocks.campaigns.mockResolvedValue([]); mocks.result.mockResolvedValue(null); mocks.departures.mockResolvedValue({ total: 40, last30Days: 4 }); mocks.arrivals.mockResolvedValue({ total: 25, last30Days: 7 }); });
  it("enforces admin authorization before reading participant state", async () => {
    mocks.admin.mockReturnValueOnce(false); await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/profile");
    expect(mocks.audience).not.toHaveBeenCalled();
  });
  it("renders exactly one composer and compact state/departure summaries without old blocks or profile warnings for signals", async () => {
    const page = await Page({ searchParams: Promise.resolve({}) }), content = text(page).replace(/\s+/gu, " ");
    expect(content).toContain("Состояние участников"); expect(content).toContain("Сообщение участникам");
    expect(content).toContain("За последние 30 дней: 4"); expect(content).toContain("Всего зарегистрировано убытий: 40");
    expect(content).toContain("Всего зарегистрировано прибытий: 25");
    for (const removed of ["Кампании Хранителя", "Аудитория технического уведомления", "История убытий:", "Без активного"]) expect(content).not.toContain(removed);
    const elements = nodes(page), composers = elements.filter(n => typeof n.type === "function" && n.type.name === "GuardianMessageComposer");
    expect(composers).toHaveLength(1); expect(composers[0].props.audiences).toHaveLength(12);
    const links = elements.filter(n => n.props.href).map(n => n.props.href as string);
    expect(links).toContain("/admin/guardian/departures"); expect(links).toContain("/admin/guardian/arrivals"); expect(links.filter(l => l.includes("#guardian-composer"))).toHaveLength(5);
    expect(links.some(l => l.includes("preset=core_login_prompt"))).toBe(true);
  });
  it("opens the requested state in the same composer and presets default login to Telegram only", async () => {
    const page = await Page({ searchParams: Promise.resolve({ preset: "core_login_prompt", condition: ["unverified"] }) });
    const composer = nodes(page).find(n => typeof n.type === "function" && n.type.name === "GuardianMessageComposer")!;
    expect(composer.props.selectedTemplate).toBe("core_login_prompt"); expect(composer.props.initialConditions).toEqual(["unverified"]);
    expect(composer.props.templates).toEqual(expect.arrayContaining([expect.objectContaining({ key: "core_login_prompt", core: false, telegram: true, system: true })]));
  });
  it("shows Telegram-only result counts from canonical batch with zero inbox messages", async () => {
    mocks.result.mockResolvedValue({ recipientCount: 3, telegramDeliveryCount: 2, audienceRule: { channels: { core: false, telegram: true } } });
    const content = text(await Page({ searchParams: Promise.resolve({ message: "id" }) })).replace(/\s+/gu, " ");
    for (const phrase of ["Получателей: 3", "В Личку Ядра: 0", "Telegram поставлено в очередь: 2", "Без доступной Telegram-доставки: 1"]) expect(content).toContain(phrase);
  });
});
