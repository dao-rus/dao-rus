import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AwardInstancePanel, AwardVisibilityForm } from "./award-instance-panel";
import { interfaceTextFields, type InterfaceTextValues } from "../lib/interface-texts";
import type { AwardInstance } from "../lib/awards";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
const texts = Object.fromEntries(interfaceTextFields.map(field => [field.key, field.defaultValue])) as InterfaceTextValues;
const date = new Date("2026-10-12T12:00:00Z");
const initial: AwardInstance = { id: "10000000-0000-4000-8000-000000000001", awardId: "award", participantId: "recipient",
  awardedByParticipantId: "founder", reason: "Reason", personalAddress: "Memory", status: "accepted", offeredAt: date,
  declinedAt: null, acceptedAt: date, rejectedAt: null, showInPublicList: false, showNextToName: false };
const NativeFormData = FormData;
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function withRenderer(instance: AwardInstance, run: (renderer: ReactTestRenderer) => Promise<void>, profile = false) {
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = environment.IS_REACT_ACT_ENVIRONMENT; environment.IS_REACT_ACT_ENVIRONMENT = true;
  // Node has no HTMLFormElement. Supply successful controls from the rendered form props.
  vi.stubGlobal("FormData", class extends NativeFormData {
    constructor(values: Record<string, string>) { super(); for (const [key, value] of Object.entries(values ?? {})) this.set(key, value); }
  });
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(profile ? <AwardVisibilityForm instance={instance} texts={texts} profile/>
      : <AwardInstancePanel instance={instance} texts={texts} awarderName="Founder"/>); });
    await run(renderer);
  } finally { if (renderer) await act(async () => renderer.unmount()); environment.IS_REACT_ACT_ENVIRONMENT = previous; }
}
function form(renderer: ReactTestRenderer, action: string) {
  return renderer.root.findAllByType("form").find(node => node.findAllByProps({ name: "action", value: action }).length)!;
}
function submit(renderer: ReactTestRenderer, action: string, values: Record<string, string> = {}) {
  return form(renderer, action).props.onSubmit({ preventDefault: vi.fn(), currentTarget: values });
}
function response(instance = initial) { return { ok: true, json: async () => ({ instance: JSON.parse(JSON.stringify(instance)), changed: true }) }; }

describe("local award feedback", () => {
  it("saves settings in place, disables controls and blocks immediate repeats across the panel", async () => {
    let resolve!: (value: unknown) => void;
    const fetch = vi.fn().mockImplementation(() => new Promise(done => { resolve = done; })); vi.stubGlobal("fetch", fetch);
    await withRenderer(initial, async renderer => {
      await act(async () => renderer.root.findByProps({ name: "showInPublicList" }).props.onChange({ target: { checked: true } }));
      let saved!: Promise<void>;
      await act(async () => {
        saved = submit(renderer, "visibility", { showInPublicList: "on" });
        void submit(renderer, "visibility", { showInPublicList: "on" });
        void submit(renderer, "reject", { confirm: "on" });
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(form(renderer, "visibility").props["aria-busy"]).toBe(true);
      expect(renderer.root.findByProps({ name: "showInPublicList" }).props.disabled).toBe(true);
      expect(renderer.root.findAllByType("button").every(button => button.props.disabled)).toBe(true);
      expect(JSON.stringify(renderer.toJSON())).toContain(texts["award.saving"]);
      expect(mocks.refresh).not.toHaveBeenCalled();
      await act(async () => { resolve(response({ ...initial, showInPublicList: true })); await saved; });
      const localNotice = form(renderer, "visibility").findByProps({ role: "status" });
      expect(localNotice.children).toEqual([texts["award.visibility_saved"]]);
      expect(renderer.root.findByProps({ name: "showInPublicList" }).props.checked).toBe(true);
      expect(renderer.root.findByProps({ name: "showNextToName" }).props.checked).toBe(false);
      expect(mocks.refresh).toHaveBeenCalledOnce();
      await act(async () => renderer.update(<AwardInstancePanel instance={{ ...initial, showInPublicList: true }} texts={texts} awarderName="Founder"/>));
      expect(form(renderer, "visibility").findByProps({ role: "status" }).children).toEqual([texts["award.visibility_saved"]]);
      expect(renderer.root.findByProps({ name: "showInPublicList" }).props.checked).toBe(true);
      const request = fetch.mock.calls[0][1]; expect(request.headers.Accept).toBe("application/json");
      expect(request.body.get("instanceId")).toBe(initial.id); expect(request.body.get("action")).toBe("visibility");
      await act(async () => renderer.root.findByProps({ name: "showNextToName" }).props.onChange({ target: { checked: true } }));
      expect(form(renderer, "visibility").findAllByProps({ role: "status" })).toHaveLength(0);
    });
  });
  it.each(["network", 401, 403, 409, 500])("retains checkbox choices and shows a local error for %s, then permits retry", async failure => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    if (failure === "network") fetch.mockRejectedValueOnce(new Error("Connection lost"));
    else fetch.mockResolvedValueOnce({ ok: false, status: failure });
    await withRenderer(initial, async renderer => {
      await act(async () => {
        renderer.root.findByProps({ name: "showInPublicList" }).props.onChange({ target: { checked: true } });
        renderer.root.findByProps({ name: "showNextToName" }).props.onChange({ target: { checked: true } });
      });
      await act(async () => { await submit(renderer, "visibility", { showInPublicList: "on", showNextToName: "on" }); });
      expect(form(renderer, "visibility").findByProps({ role: "alert" }).children.length).toBeGreaterThan(0);
      for (const name of ["showInPublicList", "showNextToName"]) {
        expect(renderer.root.findByProps({ name }).props.checked).toBe(true);
        expect(renderer.root.findByProps({ name }).props.disabled).toBe(false);
      }
      expect(mocks.refresh).not.toHaveBeenCalled();
      fetch.mockResolvedValueOnce(response({ ...initial, showInPublicList: true, showNextToName: true }));
      await act(async () => { await submit(renderer, "visibility", { showInPublicList: "on", showNextToName: "on" }); });
      expect(form(renderer, "visibility").findAllByProps({ role: "alert" })).toHaveLength(0);
      expect(form(renderer, "visibility").findByProps({ role: "status" }).children).toEqual([texts["award.visibility_saved"]]);
    });
  });
  it.each(["accept", "decline"] as const)("makes %s obvious, updating state and actual dates without navigation", async action => {
    const updated = { ...initial, status: action === "accept" ? "accepted" : "declined", acceptedAt: action === "accept" ? date : null, declinedAt: action === "decline" ? date : null } as AwardInstance;
    const fetch = vi.fn().mockResolvedValue(response(updated)); vi.stubGlobal("fetch", fetch);
    await withRenderer({ ...initial, status: "offered", acceptedAt: null }, async renderer => {
      await act(async () => { await submit(renderer, action); });
      const content = JSON.stringify(renderer.toJSON());
      expect(content).toContain(texts[`award.${action}_saved`]);
      expect(content).toContain(texts[action === "accept" ? "award.acceptedAt" : "award.declinedAt"]);
      expect(renderer.root.findAllByProps({ name: "showInPublicList" }).length).toBe(action === "accept" ? 1 : 0);
      expect(form(renderer, "decline")).toBeUndefined();
      if (action === "decline") expect(form(renderer, "accept")).toBeDefined();
      expect(mocks.refresh).toHaveBeenCalledOnce();
    });
  });
  it("shows failed acceptance at its controls without hiding the available actions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    await withRenderer({ ...initial, status: "offered", acceptedAt: null }, async renderer => {
      await act(async () => { await submit(renderer, "accept"); });
      expect(renderer.root.findByProps({ className: "awardActions" }).findByProps({ role: "alert" })).toBeDefined();
      expect(form(renderer, "accept")).toBeDefined(); expect(form(renderer, "decline")).toBeDefined();
      expect(mocks.refresh).not.toHaveBeenCalled();
    });
  });
  it("keeps a rejection error at its confirmation controls", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    await withRenderer(initial, async renderer => {
      await act(async () => { await submit(renderer, "reject", { confirm: "on" }); });
      expect(form(renderer, "reject").findByProps({ role: "alert" })).toBeDefined();
      expect(renderer.root.findByProps({ name: "confirm" }).props.disabled).toBe(false);
      expect(form(renderer, "visibility")).toBeDefined();
    });
  });
  it("also saves locally in the profile and updates accepted terminal rejection without losing history", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(initial)));
    await withRenderer(initial, async renderer => {
      expect(renderer.root.findByProps({ name: "returnTo" }).props.value).toBe("profile");
      await act(async () => { await submit(renderer, "visibility"); });
      expect(form(renderer, "visibility").findByProps({ role: "status" }).children).toEqual([texts["award.visibility_saved"]]);
    }, true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...initial, status: "rejected", rejectedAt: date })));
    await withRenderer(initial, async renderer => {
      expect(renderer.root.findByProps({ name: "confirm" }).props.required).toBe(true);
      await act(async () => { await submit(renderer, "reject", { confirm: "on" }); });
      expect(JSON.stringify(renderer.toJSON())).toContain(texts["award.reject_saved"]);
      expect(form(renderer, "accept")).toBeUndefined(); expect(form(renderer, "reject")).toBeUndefined();
      expect(JSON.stringify(renderer.toJSON())).toContain("Memory");
    });
  });
});
