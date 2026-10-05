import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { previewDepartureArchive, summarizeDepartureArchive, departureReviewModel, departureChannel } from "./telegram-departure-archive";
import { renderDepartureReviewHtml } from "./telegram-departure-review-html";

const people = [
  { id: "11111111-1111-4111-8111-111111111111", display_name: "Первый", usernames: ["first_user"] },
  { id: "22222222-2222-4222-8222-222222222222", display_name: "Второй", usernames: ["second_user"] },
];
function setup(name = people[0].display_name) {
  const participants = [{ ...people[0], display_name: name }, people[1]];
  const rows = previewDepartureArchive({ source_channel: departureChannel, messages: [
    { id: 1, date: "2020-01-01T00:00:00Z", text: "@first_user" },
    { id: 2, date: "2021-01-01T00:00:00Z", text: "Иван" },
    { id: 3, date: "2022-01-01T00:00:00Z", text: "@historical_user" },
  ] }, participants);
  const html = renderDepartureReviewHtml({ model_version: departureReviewModel, source_channel: departureChannel, archive_sha256: "digest", rows, participants, summary: summarizeDepartureArchive(rows), images: { 1: ["data:image/jpeg;base64,AA=="] } });
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  class Element {
    children: Element[] = []; textContent = ""; value = ""; className = "";
    handlers: Record<string, (event: unknown) => unknown> = {};
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = children; }
    addEventListener(name: string, handler: (event: unknown) => unknown) { this.handlers[name] = handler; }
    remove() {} click() {}
  }
  const ids: Record<string, Element> = {};
  for (const id of ["review-data", "entries", "progress", "totals", "notice", "filter", "download", "resume"]) ids[id] = new Element();
  ids["review-data"].textContent = scripts[0]; ids.filter.value = "all";
  const blobs: Blob[] = [];
  const context = vm.createContext({ document: { getElementById: (id: string) => ids[id], createElement: () => new Element(), body: new Element() }, Blob,
    URL: { createObjectURL(blob: Blob) { blobs.push(blob); return "blob:local"; }, revokeObjectURL() {} } });
  vm.runInContext(scripts[1], context);
  const mapping = () => JSON.parse(vm.runInContext("JSON.stringify(buildReviewedMapping())", context));
  return { html, scripts, context, mapping, ids, blobs };
}

describe("local username departure review", () => {
  it("renders all entries, embeds screenshots, never pre-confirms and forbids network", () => {
    const page = setup();
    expect(page.ids.entries.children).toHaveLength(3);
    expect(page.ids.entries.children[0].children[0].children).toHaveLength(1);
    expect(page.mapping().mappings.every((m: { confirmed: boolean }) => !m.confirmed)).toBe(true);
    expect(page.html).toContain("connect-src 'none'");
    expect(page.scripts[1]).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
  });
  it("exports human username confirmation with a null future historical Participant ID", async () => {
    const page = setup();
    vm.runInContext("confirm(3,'historical'); unresolved(2)", page.context);
    page.ids.download.handlers.click({});
    const downloaded = JSON.parse(await page.blobs[0].text());
    expect(downloaded).toMatchObject({ model_version: departureReviewModel, source_channel: departureChannel, archive_sha256: "digest" });
    expect(downloaded.mappings[2]).toMatchObject({ archived_username: "@historical_user", target: "historical", participant_id: null, confirmed: true, event_type: "forum.left" });
    expect(downloaded.mappings[1]).toMatchObject({ archived_username: null, participant_id: null, confirmed: false, review_status: "unresolved" });
  });
  it("blocks duplicate creation/current unrelated choices and accepts reviewed exact current collision", () => {
    const page = setup();
    expect(() => vm.runInContext("confirm(1,'historical')", page.context)).toThrow();
    expect(() => vm.runInContext(`confirm(1,'existing_current','${people[1].id}')`, page.context)).toThrow();
    vm.runInContext(`confirm(1,'existing_current','${people[0].id}')`, page.context);
    expect(page.mapping().mappings[0]).toMatchObject({ target: "existing_current", participant_id: people[0].id, confirmed: true });
  });
  it("requires a usable username and resets human confirmation on username/name edits", () => {
    const page = setup();
    expect(() => vm.runInContext("confirm(2,'historical')", page.context)).toThrow();
    vm.runInContext("confirm(3,'historical'); edit(3,'archived_username','@corrected_user')", page.context);
    expect(page.mapping().mappings[2]).toMatchObject({ archived_username: "@corrected_user", target: null, confirmed: false });
    vm.runInContext("confirm(3,'historical'); edit(3,'archived_display_name','Проверенное имя')", page.context);
    expect(page.mapping().mappings[2]).toMatchObject({ archived_display_name: "Проверенное имя", confirmed: false });
  });
  it("escapes untrusted names without creating executable script tags", () => {
    const page = setup('</script><script>alert("bad")</script>');
    expect(page.scripts).toHaveLength(2); expect(page.html).toContain("\\u003c/script\\u003e");
  });
  it("resumes reviewed username mappings and rejects old/foreign/invalid files atomically", async () => {
    const page = setup();
    vm.runInContext("confirm(3,'historical')", page.context);
    const before = page.mapping();
    vm.runInContext(`restore(${JSON.stringify(before)})`, page.context);
    expect(page.mapping()).toEqual(before);
    for (const input of [{ ...before, model_version: "old" }, { ...before, archive_sha256: "other" }, { ...before, mappings: [before.mappings[2], { ...before.mappings[0], confirmed: true, target: "historical", participant_id: null }] }]) {
      expect(() => vm.runInContext(`restore(${JSON.stringify(input)})`, page.context)).toThrow();
      expect(page.mapping()).toEqual(before);
    }
    await page.ids.resume.handlers.change({ target: { files: [{ text: async () => JSON.stringify({ ...before, model_version: "old" }) }], value: "x" } });
    expect(page.ids.notice.textContent).toContain("устаревшая модель");
  });
});
