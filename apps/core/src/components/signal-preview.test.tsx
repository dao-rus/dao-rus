import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignalPreview } from "./signal-preview";

const href = "/exchange/10000000-0000-4000-8000-000000000001";
const longLabel = "  Очень длинный ярлык " + "слово ".repeat(200) + "\n";
const render = (props: Partial<Parameters<typeof SignalPreview>[0]> = {}, children?: React.ReactNode) =>
  renderToStaticMarkup(<SignalPreview href={href} label="Ищу работу" {...props}>{children}</SignalPreview>);

describe("Signal preview card", () => {
  it("is one canonical link that holds the whole content, with no nested or second link", () => {
    const html = render({ description: "Смотри [тут](https://example.org) и https://example.org/x", author: "Анна", kicker: "Нужно" });
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain(`<a class="signalPreview" href="${href}">`);
    const link = html.slice(html.indexOf("<a "), html.indexOf("</a>"));
    for (const part of ["Нужно", "Ищу работу", "Смотри", "Анна"]) expect(link).toContain(part);
  });
  it("renders label as plain text, author as a caption and Markdown links as inert text", () => {
    const html = render({ label: "**Важно** https://example.org", description: "[сайт](https://example.org)", author: "Анна" });
    expect(html).toContain('<span class="signalPreviewLabel">');
    expect(html).toContain("<strong>Важно</strong>");
    expect(html).toContain('<span class="signalPreviewAuthor">Анна</span>');
    expect(html).toContain('<span class="userTextLink">сайт</span>');
    expect(html).not.toContain('href="https://example.org');
    expect(html).not.toContain("/profile/");
  });
  it("keeps the text of a long label intact (clamping is CSS only)", () => {
    const html = render({ label: longLabel });
    expect(html).toContain(longLabel.trim().replaceAll("\n", ""));
    expect(html).not.toContain("…");
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(/\.signalPreviewLabel \{[^}]*-webkit-line-clamp: 4/);
  });
  it("puts action controls outside the link, so the card has valid, separately focusable controls", () => {
    const html = render({}, <button type="submit">Откликнуться</button>);
    expect(html.indexOf("</a>")).toBeLessThan(html.indexOf("<button"));
    expect(html).toContain('class="signalPreviewActions"');
    expect(render()).not.toContain("signalPreviewActions");
  });
  it("renders as a list item when asked", () => {
    expect(render({ as: "li" })).toMatch(/^<li class="signalPreviewCard">/);
  });
  it("keeps keyboard focus and hover affordances without underline or link colour", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(/\.signalPreview:focus-visible \{[^}]*outline:/);
    expect(css).toMatch(/\.signalPreviewCard:hover[^{]*\{[^}]*border-color/);
    expect(css).toMatch(/\.signalPreview \{[^}]*text-decoration: none[^}]*cursor: pointer|\.signalPreview \{[^}]*cursor: pointer[^}]*text-decoration: none/);
    expect(css).toMatch(/\.signalPreview \{[^}]*color: var\(--ink\)/);
  });
});
