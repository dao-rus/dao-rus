import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuardianMessageComposer, type GuardianComposerProps } from "./guardian-message-composer";
import { interfaceTextFields } from "../lib/interface-texts";
const props: GuardianComposerProps = {
  templates: [
    { key: "core_login_prompt", title: "Войти в Ядро", defaultText: "Авторизуйтесь в Ядре ДАО.", condition: "never_logged_in", system: true, core: false, telegram: true, previous: null },
    { key: "town_meeting", title: "Встреча в городе", defaultText: "Приглашаем на встречу.", condition: "city", system: false, core: true, telegram: true, previous: null },
    { key: "online_meeting", title: "Онлайн-встреча", defaultText: "Онлайн-встреча", condition: null, system: false, core: true, telegram: true, previous: null },
  ], selectedTemplate: "", initialConditions: [], initialCity: "", initialInterests: [], submissionId: "key",
  cities: [{ key: "city", label: "Москва" }], interests: [{ key: "art", label: "Искусство" }],
  audiences: [{ key: "all_current", label: "Все актуальные" }, { key: "never_logged_in", label: "Никогда не входили" }, { key: "city", label: "Город" }],
  texts: Object.fromEntries(interfaceTextFields.map(f => [f.key, f.defaultValue])),
};
const preview = { recipientCount: 2, text: "Итоговый текст с наградой.", actionLabel: "Войти в Ядро", rewardNote: "Награда: +3 DARUS", core: false, telegram: true };
afterEach(() => vi.unstubAllGlobals());
async function render(input = props) {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<GuardianMessageComposer {...input} />, { createNodeMock: element => element.type === "form" ? {} : null }); });
  return renderer;
}
async function withRenderer(input: GuardianComposerProps, run: (renderer: ReactTestRenderer) => Promise<void>) {
  const env = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = env.IS_REACT_ACT_ENVIRONMENT; env.IS_REACT_ACT_ENVIRONMENT = true;
  const NativeFormData = globalThis.FormData;
  vi.stubGlobal("FormData", class extends NativeFormData { constructor() { super(); } });
  let renderer: ReactTestRenderer | undefined;
  try { renderer = await render(input); await run(renderer); }
  finally { if (renderer) await act(async () => renderer!.unmount()); env.IS_REACT_ACT_ENVIRONMENT = previous; }
}
describe("single Guardian composer", () => {
  it("renders one form with simple audience/text/channel controls and no technical recipient or CTA inputs", () => {
    const html = renderToStaticMarkup(<GuardianMessageComposer {...props} />);
    expect(html.match(/<form /g)).toHaveLength(1);
    for (const text of ["Аудитория", "Шаблон сообщения", "Сообщение", "Ядро", "Telegram", "Предпросмотр"]) expect(html).toContain(text);
    for (const field of ["recipient_ids", "recipient_count", "action_url", "notification_type", "campaign_key"]) expect(html).not.toContain(`name="${field}"`);
  });
  it("presets select the correct audience/default channels; templates stay editable and city meeting requires a city", async () => {
    await withRenderer(props, async renderer => {
      await act(async () => renderer.root.findByProps({ id: "guardian-template" }).props.onChange({ target: { value: "core_login_prompt" } }));
      expect(renderer.root.findByProps({ name: "core" }).props.checked).toBe(false);
      expect(renderer.root.findByProps({ name: "telegram" }).props.checked).toBe(true);
      expect(renderer.root.findByProps({ name: "condition" }).props.value).toEqual(["never_logged_in"]);
      await act(async () => renderer.root.findByProps({ name: "condition" }).props.onChange({ target: { selectedOptions: [] } }));
      expect(renderer.root.findByProps({ name: "condition" }).props.value).toEqual(["never_logged_in"]);
      await act(async () => renderer.root.findByProps({ id: "guardian-template" }).props.onChange({ target: { value: "town_meeting" } }));
      expect(renderer.root.findByProps({ name: "city" }).props.required).toBe(true);
      expect(renderer.root.findAllByType("button")[0].props.disabled).toBe(true);
      await act(async () => renderer.root.findByProps({ name: "city" }).props.onChange({ target: { value: "city" } }));
      expect(renderer.root.findAllByType("button")[0].props.disabled).toBe(false);
    });
  });
  it("requires server preview, shows final text/CTA/reward/channels and invalidates after every edit", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => preview }); vi.stubGlobal("fetch", fetch);
    await withRenderer({ ...props, selectedTemplate: "core_login_prompt" }, async renderer => {
      const preventDefault = vi.fn();
      await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault })); expect(preventDefault).toHaveBeenCalledOnce();
      await act(async () => renderer.root.findAllByType("button")[0].props.onClick());
      expect(fetch).toHaveBeenCalledWith("/api/admin/guardian/message", expect.objectContaining({ method: "POST" }));
      expect(renderer.root.findByProps({ "aria-label": "Предпросмотр сообщения" })).toBeTruthy();
      const content = JSON.stringify(renderer.toJSON());
      for (const text of [preview.text, preview.rewardNote, preview.actionLabel, "Telegram", "Отправить 2"]) expect(content).toContain(text);
      expect(renderer.root.findByProps({ name: "confirm" }).props.disabled).toBe(false);
      await act(async () => renderer.root.findByType("textarea").props.onChange({ target: { value: "Другой текст" } }));
      expect(renderer.root.findAllByProps({ name: "confirm" })).toHaveLength(0);
    });
  });
  it("rejects stale preview responses and disables sending to an empty audience", async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValueOnce({ ok: true, json: async () => ({ ...preview, recipientCount: 0 }) }));
    await withRenderer({ ...props, selectedTemplate: "core_login_prompt" }, async renderer => {
      await act(async () => { void renderer.root.findAllByType("button")[0].props.onClick(); });
      await act(async () => renderer.root.findByType("textarea").props.onChange({ target: { value: "Изменённый текст" } }));
      await act(async () => resolve({ ok: true, json: async () => preview }));
      expect(renderer.root.findAllByProps({ name: "confirm" })).toHaveLength(0);
      await act(async () => renderer.root.findAllByType("button")[0].props.onClick());
      expect(renderer.root.findByProps({ name: "confirm" }).props.disabled).toBe(true);
    });
  });
  it("blocks empty text, no channels, previously launched version and repeated submit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => preview }));
    await withRenderer({ ...props, selectedTemplate: "core_login_prompt" }, async renderer => {
      await act(async () => renderer.root.findByProps({ name: "telegram" }).props.onChange({ target: { checked: false } }));
      expect(renderer.root.findAllByType("button")[0].props.disabled).toBe(true);
      await act(async () => renderer.root.findByProps({ name: "telegram" }).props.onChange({ target: { checked: true } }));
      await act(async () => renderer.root.findByType("textarea").props.onChange({ target: { value: " " } }));
      expect(renderer.root.findAllByType("button")[0].props.disabled).toBe(true);
      await act(async () => renderer.root.findByType("textarea").props.onChange({ target: { value: "Текст" } }));
      await act(async () => renderer.root.findAllByType("button")[0].props.onClick());
      const preventDefault = vi.fn();
      await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault }));
      expect(renderer.root.findByProps({ name: "confirm" }).props.disabled).toBe(true);
      await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault })); expect(preventDefault).toHaveBeenCalledOnce();
    });
    const html = renderToStaticMarkup(<GuardianMessageComposer {...props} selectedTemplate="core_login_prompt"
      templates={props.templates.map(t => ({ ...t, previous: { text: "Старое сообщение", recipients: 2, coreInbox: 0, telegramQueued: 2 } }))} />);
    expect(html).toContain("Этот системный шаблон уже отправлен."); expect(html).toContain("Старое сообщение");
  });
});
