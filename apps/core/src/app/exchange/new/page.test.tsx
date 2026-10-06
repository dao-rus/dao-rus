import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ participant: vi.fn(), types: vi.fn(), signals: vi.fn(), texts: vi.fn() }));
vi.mock("../../../lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("../../../lib/signals", () => ({ listSignalTypes: mocks.types, listParticipantSignals: mocks.signals }));
vi.mock("../../../lib/interface-texts", () => ({ readInterfaceTexts: mocks.texts }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); }, notFound: () => { throw new Error("notFound"); } }));
import Page from "./page";
import { SignalForm } from "../../../components/signal-form";
function forms(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(forms);
  if (!isValidElement(node)) return [];
  return node.type === SignalForm ? [node.props as Record<string, unknown>] : forms((node.props as { children?: ReactNode }).children);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.participant.mockResolvedValue({ id: "owner" });
  mocks.types.mockResolvedValue([{ key: "need", displayName: "Нужно", enabled: true },
    { key: "future_type", displayName: "Будущий тип", enabled: true }, { key: "disabled", displayName: "Disabled", enabled: false }]);
  mocks.signals.mockResolvedValue([]);
  mocks.texts.mockResolvedValue({ values: {} });
});
describe("/exchange/new", () => {
  it("renders the enabled catalogue and preselects query type", async () => {
    const form = forms(await Page({ searchParams: Promise.resolve({ type: "future_type" }) }))[0];
    expect(form.initialType).toBe("future_type");
    expect((form.types as { key: string }[]).map((type) => type.key)).toEqual(["need", "future_type"]);
  });
  it("defaults to need for unknown type", async () => {
    expect(forms(await Page({ searchParams: Promise.resolve({ type: "unknown" }) }))[0].initialType).toBe("need");
  });
  it("rejects guests and unavailable foreign/archived editing without exposing records", async () => {
    await expect(Page({ searchParams: Promise.resolve({ signal: "foreign-id" }) })).rejects.toThrow("notFound");
    expect(mocks.signals).toHaveBeenCalledWith("owner", "owner");
    mocks.participant.mockResolvedValue(null);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect");
  });
  it("allows voluntary refinement of an owned existing disabled type", async () => {
    const signal = { id: "own", typeKey: "disabled", label: "Полный текст", legacyBody: true };
    mocks.signals.mockResolvedValue([signal]);
    const form = forms(await Page({ searchParams: Promise.resolve({ signal: "own" }) }))[0];
    expect(form.signal).toEqual(signal);
    expect(form.initialType).toBe("disabled");
  });
});
