import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { interfaceTextFields, type InterfaceTextValues } from "../lib/interface-texts";
import { AngelSearch } from "./angel-search";

describe("Angel search on Exchange", () => {
  it("shows the explanation, example placeholder and Find button", () => {
    const texts = Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) as InterfaceTextValues;
    const html = renderToStaticMarkup(<AngelSearch texts={texts} />);
    expect(html).toContain("Ангел поможет найти человека, знание, навык или ресурс.");
    expect(html).toContain('placeholder="Например: кто разбирается в ремонте старых домов?"');
    expect(html).toContain(">Найти</button>");
    expect(html).not.toContain("Спросить Ангела");
  });
});
