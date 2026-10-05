import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GuardianBroadcastForm } from "./guardian-broadcast-form";
const props = { city: "city", interests: ["art"], recipientCount: 2, submissionId: "key",
  texts: { "guardian.message": "Сообщение", "guardian.channel_core": "Ядро", "guardian.channel_telegram": "Telegram", "guardian.send": "Отправить {count}" } };
describe("Guardian broadcast controls", () => {
  it("shows simple channel/message controls without technical recipient fields", () => {
    const html = renderToStaticMarkup(<GuardianBroadcastForm {...props} />);
    for (const text of ["Сообщение", "Ядро", "Telegram", "Отправить 2"]) expect(html).toContain(text);
    for (const field of ["recipient_ids", "recipient_count", "notification_type", "action_url"]) expect(html).not.toContain(`name="${field}"`);
  });
  it("disables empty text, empty audience, no channels and repeated submit", async () => {
    const env = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previous = env.IS_REACT_ACT_ENVIRONMENT; env.IS_REACT_ACT_ENVIRONMENT = true;
    let renderer!: ReactTestRenderer;
    try {
      await act(async () => { renderer = create(<GuardianBroadcastForm {...props} />); });
      const disabled = () => renderer.root.findByType("button").props.disabled;
      expect(disabled()).toBe(true);
      await act(async () => { renderer.root.findByType("textarea").props.onChange({ target: { value: "Текст" } }); });
      expect(disabled()).toBe(false);
      await act(async () => { renderer.update(<GuardianBroadcastForm {...props} recipientCount={0} />); }); expect(disabled()).toBe(true);
      await act(async () => { renderer.update(<GuardianBroadcastForm {...props} />); renderer.root.findByProps({ name: "core" }).props.onChange({ target: { checked: false } }); });
      expect(disabled()).toBe(true);
      await act(async () => { renderer.root.findByProps({ name: "telegram" }).props.onChange({ target: { checked: true } }); }); expect(disabled()).toBe(false);
      const preventDefault = vi.fn();
      await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault }); }); expect(disabled()).toBe(true);
      await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault }); }); expect(preventDefault).toHaveBeenCalledOnce();
    } finally { if (renderer) await act(async () => renderer.unmount()); env.IS_REACT_ACT_ENVIRONMENT = previous; }
  });
});
