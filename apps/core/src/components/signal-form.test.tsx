import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignalForm } from "./signal-form";
import { ProfileSignals } from "./profile-signals";
import { interfaceTextFields, type InterfaceTextValues } from "../lib/interface-texts";
import type { Signal } from "../lib/signals";

const texts = Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) as InterfaceTextValues;
const types = [
  { key: "future_type", displayName: "Будущий тип", enabled: true },
  { key: "disabled", displayName: "Отключённый", enabled: false },
  { key: "dating", displayName: "Знакомства", enabled: true },
];
const signal: Signal = { id: "s", ownerId: "owner", typeKey: "future_type", label: "  " + "я".repeat(900) + "\n ",
  description: null, legacyBody: true, status: "active", visibility: "private", createdAt: new Date(), updatedAt: new Date() };

describe("universal Signal UX", () => {
  it("renders arbitrary enabled types, separate content fields and optional details", () => {
    const html = renderToStaticMarkup(<SignalForm types={types} initialType="future_type" texts={texts} />);
    expect(html).toContain("Будущий тип");
    expect(html).not.toContain("Отключённый");
    expect(html).toMatch(/<input[^>]*required=""[^>]*maxLength="120"[^>]*name="label"/);
    expect(html).toContain('name="description" maxLength="10000"');
    expect(html).not.toMatch(/name="description"[^>]*required/);
    expect(html).not.toContain('name="body"');
    expect(html).toContain("Помочь сформулировать с Ангелом");
    expect(html).toContain("Предложить формулировку");
  });
  it("leaves semantic normalization to the owner and preserves the complete original", () => {
    const html = renderToStaticMarkup(<SignalForm types={types} initialType="future_type" signal={signal} texts={texts} />);
    expect(html).toContain("Исходная запись");
    expect(html).toContain('value=""');
    expect(html).toContain(signal.label);
    expect(html).toContain('name="signal_id"');
    expect(html).not.toContain('name="type_key" value="disabled"');
  });
  it("defaults dating to private and offers no publication or blind option", () => {
    const html = renderToStaticMarkup(<SignalForm types={types} initialType="dating" texts={texts} />);
    expect(html).toContain('value="private" selected=""');
    for (const value of ["public", "members", "network_blind"]) expect(html).not.toContain(`option value="${value}"`);
  });
  it("shows populated types only, legacy text and owner actions, including disabled historical types", () => {
    const html = renderToStaticMarkup(<ProfileSignals signals={[signal, { ...signal, id: "s2", typeKey: "disabled", label: "История" }]}
      types={types} texts={texts} owner />);
    expect(html).toContain(signal.label);
    expect(html).toContain("Уточнить формулировку");
    expect(html).toContain('id="signal-future_type"');
    expect(html).toContain('id="signal-disabled"');
    expect(html).not.toContain('id="signal-dating"');
    expect(html).toContain('/exchange/new?signal=s');
    expect(html).toContain('href="/exchange/s"');
    expect(html).toContain('value="archive_signal"');
  });
  it("adds neither owner actions nor empty/hidden category clues to foreign profiles", () => {
    const html = renderToStaticMarkup(<ProfileSignals signals={[]} types={types} texts={texts} />);
    expect(html).not.toContain("Будущий тип");
    expect(html).not.toContain("Знакомства");
    expect(html).not.toContain("Уточнить");
    expect(html).not.toContain("form");
  });
});
