import { describe, expect, it } from "vitest";
import {
  interfaceTextFields,
  parseInterfaceTextForm,
  readInterfaceTextsWithDatabase,
  saveInterfaceTextsWithDatabase,
  type InterfaceTextClient,
  type InterfaceTextDatabase,
} from "./interface-texts";

class FakeDatabase implements InterfaceTextDatabase, InterfaceTextClient {
  overrides = new Map<string, string>();
  events: Array<{ actorId: unknown; payload: Record<string, unknown> }> = [];
  released = false;

  async connect() { return this; }
  release() { this.released = true; }

  async query(text: string, values?: unknown[]) {
    if (text.startsWith("SELECT key, value FROM ui_text_overrides")) {
      return {
        rowCount: this.overrides.size,
        rows: [...this.overrides].map(([key, value]) => ({ key, value })),
      };
    }
    if (text.startsWith("INSERT INTO ui_text_overrides")) {
      this.overrides.set(String(values?.[0]), String(values?.[1]));
    }
    if (text.startsWith("DELETE FROM ui_text_overrides")) {
      this.overrides.delete(String(values?.[0]));
    }
    if (text.startsWith("INSERT INTO events")) {
      this.events.push({
        actorId: values?.[0],
        payload: JSON.parse(String(values?.[1])) as Record<string, unknown>,
      });
      expect(text).toContain("interface.texts_updated");
    }
    return { rowCount: 1, rows: [] };
  }
}

function formWithDefaults() {
  const form = new FormData();
  for (const field of interfaceTextFields) form.set(field.key, field.defaultValue);
  return form;
}

describe("interface texts", () => {
  it("uses hardcoded defaults when the database has no overrides", async () => {
    const state = await readInterfaceTextsWithDatabase(new FakeDatabase());
    for (const field of interfaceTextFields) {
      expect(state.values[field.key]).toBe(field.defaultValue);
      expect(state.overrides[field.key]).toBeNull();
    }
  });

  it("saves only allowed overrides and audits the actor and changed keys without text", async () => {
    const database = new FakeDatabase();
    const form = formWithDefaults();
    form.set("home.title", "Новый заголовок");
    form.set("unlisted.key", "Нельзя добавить");

    const changed = await saveInterfaceTextsWithDatabase(
      database, "admin-id", parseInterfaceTextForm(form),
    );

    expect(changed).toEqual(["home.title"]);
    expect([...database.overrides]).toEqual([["home.title", "Новый заголовок"]]);
    expect((await readInterfaceTextsWithDatabase(database)).values["home.title"])
      .toBe("Новый заголовок");
    expect(database.events).toEqual([{
      actorId: "admin-id",
      payload: { changed_by_participant_id: "admin-id", keys: ["home.title"] },
    }]);
    expect(JSON.stringify(database.events)).not.toContain("Новый заголовок");
    expect(database.released).toBe(true);
  });

  it("removes one override to restore its default without changing other fields", async () => {
    const database = new FakeDatabase();
    database.overrides.set("home.title", "Старый заголовок");
    database.overrides.set("home.lead", "Свой текст");
    const form = formWithDefaults();
    form.set("home.lead", "Свой текст");
    form.set("reset.home.title", "on");

    expect(await saveInterfaceTextsWithDatabase(database, "admin-id", parseInterfaceTextForm(form)))
      .toEqual(["home.title"]);
    expect(database.overrides.has("home.title")).toBe(false);
    expect(database.overrides.get("home.lead")).toBe("Свой текст");
    expect((await readInterfaceTextsWithDatabase(database)).values["home.title"])
      .toBe("ДАО Русь");
    expect(database.events).toHaveLength(1);

    expect(await saveInterfaceTextsWithDatabase(database, "admin-id", parseInterfaceTextForm(form)))
      .toEqual([]);
    expect(database.events).toHaveLength(1);
  });
});
