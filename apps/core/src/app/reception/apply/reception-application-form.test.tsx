import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interfaceTextFields, type InterfaceTextValues } from "../../../lib/interface-texts";
import { ReceptionApplicationForm } from "./reception-application-form";

const texts = Object.fromEntries(interfaceTextFields.map(field => [field.key, field.defaultValue])) as InterfaceTextValues;
let renderer: ReactTestRenderer;
const fetchMock = vi.fn();
const ready = vi.fn();
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status }); }
async function mount() { await act(async () => { renderer = create(<ReceptionApplicationForm texts={texts} botUrl="https://t.me/ReceptionTestBot" />); }); }
async function change(name: string, value: string | boolean) {
  await act(async () => renderer.root.findByProps({ name }).props.onChange({ target: { value, checked: value } }));
}
async function submit() { await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} })); }
const rendered = () => JSON.stringify(renderer.toJSON());

describe("Reception candidate form", () => {
  it("shows a profile preview and no future-publication wording", async () => {
    fetchMock.mockResolvedValue(json({ application: { city: "Тверь", occupation: "Мастер", age: 35, publishAge: false } }));
    await mount();
    expect(rendered()).toContain("Предпросмотр профиля");
    expect(rendered()).not.toContain("будущей публикации");
    expect(rendered()).not.toContain("Согласен на публикацию");
  });
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("window", { Telegram: { WebApp: { initData: "synthetic-init-data", ready, expand: vi.fn() } } });
    vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); ready.mockClear();
    fetchMock.mockResolvedValue(json({ application: null }));
  });
  afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.unstubAllGlobals(); });
  it("loads using Reception API with Authorization and no Core/Dev session", async () => {
    await mount(); expect(ready).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/reception/application", expect.objectContaining({ headers: { Authorization: "tma synthetic-init-data" }, credentials: "omit" }));
    expect(renderer.root.findAllByProps({ name: "publishAge" })).toHaveLength(0);
  });
  it("shows age in the profile preview without a publication consent control", async () => {
    await mount(); await change("city", "Тверь"); await change("occupation", "Мастер"); await change("age", "35");
    expect(renderer.root.findByProps({ className: "receptionPreview" }).findAllByType("dd").map(node => node.children.join(""))).toContain("35");
    expect(renderer.root.findAllByProps({ name: "publishAge" })).toHaveLength(0);
  });
  it("saves the profile and permits corrections", async () => {
    await mount(); await change("city", " Тверь "); await change("occupation", "Мастер"); await change("age", "35");
    fetchMock.mockResolvedValue(json({ application: {} }, 201)); await submit();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ city: "Тверь", occupation: "Мастер", education: null, familyStatus: null, age: 35, publishAge: false });
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(rendered()).toContain(texts["reception.apply.saved"]);
    await change("age", ""); expect(rendered()).not.toContain(texts["reception.apply.saved"]);
    await submit(); expect(fetchMock.mock.calls[2][1].method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ age: null, publishAge: false });
  });
  it("restores a saved application and edits it with PUT", async () => {
    fetchMock.mockResolvedValue(json({ application: { city: "Тверь", occupation: "Мастер", age: 35, publishAge: true } }));
    await mount(); expect(renderer.root.findByProps({ name: "city" }).props.value).toBe("Тверь");
    expect(renderer.root.findAllByProps({ name: "publishAge" })).toHaveLength(0);
    await change("occupation", "Ремесленник"); await submit(); expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
  });
  it.each(["load", "save"])("asks to reopen Mini App when %s returns 401", async operation => {
    if (operation === "load") fetchMock.mockResolvedValue(json({}, 401));
    await mount();
    if (operation === "save") { fetchMock.mockResolvedValue(json({}, 401)); await submit(); }
    expect(rendered()).toContain("откройте анкету заново через бота Приёмной");
    expect(renderer.root.findAllByType("form")).toHaveLength(0);
  });
  it("does not fetch or offer Dev login outside Telegram", async () => {
    vi.stubGlobal("window", { Telegram: { WebApp: { initData: "" } } });
    await mount(); expect(fetchMock).not.toHaveBeenCalled(); expect(rendered()).toContain("Заполнить анкету");
  });
  it("blocks editing on failed initial load and does not report failed writes as saved", async () => {
    fetchMock.mockResolvedValue(json({}, 503)); await mount(); expect(renderer.root.findAllByType("form")).toHaveLength(0);
    fetchMock.mockResolvedValue(json({ application: null }));
    await act(async () => renderer.root.findByType("button").props.onClick());
    fetchMock.mockResolvedValue(json({}, 429)); await submit(); expect(rendered()).toContain("Попробуйте через минуту");
    expect(rendered()).not.toContain(texts["reception.apply.saved"]);
  });
  it("blocks a second submit while saving", async () => {
    await mount(); let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    await act(async () => { void renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    await act(async () => { void renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => resolve(json({ application: {} })));
  });
});
