import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeDiscussion } from "./code-discussion";
import { ProfileSignals } from "./profile-signals";
import { UserText } from "./user-text";
import { interfaceTextFields } from "../lib/interface-texts";
import type { CodeComment } from "../lib/code-comments";
import type { Signal } from "../lib/signals";

const render = (text: string, inline = false) => renderToStaticMarkup(<UserText text={text} inline={inline} />);
const anchor = (href: string, text = href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

describe("UserText safe Markdown renderer", () => {
  it("keeps plain text plain and turns line breaks into <br>", () => {
    expect(render("Просто текст")).toBe('<div class="userText"><p>Просто текст</p></div>');
    expect(render("строка 1\nстрока 2\n\nабзац 2")).toBe(
      '<div class="userText"><p>строка 1<br/>строка 2</p><p>абзац 2</p></div>');
  });
  it("links bare URLs without trailing punctuation and Markdown links, always external and safe", () => {
    expect(render("см. https://example.org/a?b=1, и дальше")).toContain(anchor("https://example.org/a?b=1") + ", и дальше");
    expect(render("[сайт](https://example.org/x)")).toContain(anchor("https://example.org/x", "сайт"));
    expect(render("http://example.org")).toContain(anchor("http://example.org/", "http://example.org"));
  });
  it("renders bold, italic and nested emphasis", () => {
    expect(render("**жирный** и *курсив*")).toContain("<strong>жирный</strong> и <em>курсив</em>");
    expect(render("**a *b* c**")).toContain("<strong>a <em>b</em> c</strong>");
    expect(render("2 * 3 * 4")).toContain("2 * 3 * 4");
  });
  it("renders bullet lists", () => {
    expect(render("Список:\n- один\n- **два**\n* три\nконец")).toBe(
      '<div class="userText"><p>Список:</p><ul><li>один</li><li><strong>два</strong></li><li>три</li></ul><p>конец</p></div>');
  });
  it("never emits raw HTML: tags, scripts, iframes and handlers stay escaped text", () => {
    const html = render('<script>alert(1)</script><iframe src="https://evil"></iframe><img src=x onerror=alert(1)><b>x</b>');
    expect(html).not.toMatch(/<(script|iframe|img|b)[ >]/);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;iframe");
  });
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "file:///etc/passwd", "//evil.example"])(
    "does not create a link for %s", (url) => {
      const html = render(`[нажми](${url}) и ${url}`);
      expect(html).not.toContain("<a ");
      expect(html).not.toContain('href="javascript');
      expect(html).not.toContain('href="data');
    });
  it("does not support headings or images", () => {
    const html = render("# Заголовок\n![pic](https://example.org/x.png)");
    expect(html).not.toMatch(/<h[1-6]|<img/);
    expect(html).toContain("# Заголовок");
  });
  it("renders inline mode without block elements, so it fits headings and list items", () => {
    expect(render("**a** https://example.org", true)).toBe(
      `<span class="userText"><strong>a</strong> ${anchor("https://example.org/", "https://example.org")}</span>`);
    expect(render("- не список", true)).toContain("- не список");
  });
  it("is deterministic and never mutates the source string", () => {
    const source = "**x**\n- y";
    expect(render(source)).toBe(render(source));
    expect(source).toBe("**x**\n- y");
  });
});

describe("one renderer across surfaces", () => {
  const markdown = "Смотри **тут** https://example.org/p";
  const signal: Signal = { id: "10000000-0000-4000-8000-000000000001", ownerId: null, typeKey: "need", label: "Ярлык",
    description: markdown, visibility: "public", status: "active", legacyBody: false,
    createdAt: new Date(), updatedAt: new Date() };

  it("renders Signal descriptions in profile lists with the shared markup", () => {
    const html = renderToStaticMarkup(<ProfileSignals signals={[signal]}
      types={[{ key: "need", displayName: "Нужно", enabled: true }]}
      texts={Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) as never} />);
    expect(html).toContain("<strong>тут</strong>");
    expect(html).toContain(anchor("https://example.org/p"));
  });

  it("renders code comments with the shared markup", () => {
    const comment: CodeComment = { id: "a", parentId: null, section: "dao-code-1",
      authorId: "10000000-0000-4000-8000-000000000001", authorName: "Алиса", verificationPoints: 0, positiveCount: 0,
      body: markdown, deleted: false, hidden: false, hiddenReason: null, pinned: false, helpfulCount: 0,
      helpedByViewer: false, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") };
    const html = renderToStaticMarkup(<CodeDiscussion section="dao-code-1" comments={[comment]} sort="latest"
      viewerId={null} isAdmin={false} initiallyOpen={true} />);
    expect(html).toContain('class="userText codeCommentBody"');
    expect(html).toContain(anchor("https://example.org/p"));
  });

  it("keeps Markdown out of names and system labels, and has no second renderer or raw-HTML sink in the app", () => {
    const files: string[] = [];
    const walk = (dir: string) => readdirSync(dir).forEach((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) files.push(path);
    });
    walk(join(__dirname, ".."));
    const source = (path: string) => readFileSync(path, "utf8");
    expect(files.filter((path) => source(path).includes("dangerouslySetInnerHTML"))).toEqual([]);
    expect(files.filter((path) => source(path).includes("parseMarkdown")).map((p) => p.replaceAll("\\", "/"))
      .every((p) => p.endsWith("components/user-text.tsx") || p.endsWith("lib/user-markdown.ts"))).toBe(true);
    // Names and machine/system strings go through plain React text, not UserText.
    for (const name of ["participant-name.tsx", "core-navigation.tsx", "telegram-avatar.tsx"]) {
      expect(source(join(__dirname, name))).not.toContain("UserText");
    }
    // Every free-text surface uses the shared component.
    for (const path of ["app/exchange/page.tsx", "app/exchange/[signalId]/page.tsx", "app/participants/page.tsx",
      "app/profile/[participantId]/page.tsx", "app/relay/page.tsx", "app/relay/[id]/page.tsx", "app/veche/page.tsx",
      "components/angel-search.tsx", "components/code-discussion.tsx", "components/profile-signals.tsx",
      "components/signal-form.tsx"]) {
      expect(source(join(__dirname, "..", path)), path).toContain("<UserText");
    }
  });
});
