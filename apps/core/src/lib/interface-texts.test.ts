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
  it("keeps page context on registry fields, including shared and dynamic screens", () => {
    for (const field of interfaceTextFields) {
      expect(field.pageLabel.trim(), field.key).not.toBe("");
      if (field.pageHref) expect(field.pageHref, field.key).toMatch(/^\/(?!\/)/);
    }
    const field = (key: string) => interfaceTextFields.find((item) => item.key === key);
    expect(field("exchange.title")).toMatchObject({ pageLabel: "Обмен", pageHref: "/exchange" });
    expect(field("exchange.lead")).toMatchObject({ pageLabel: "Обмен", pageHref: "/exchange" });
    expect(field("signal.new_title")).toMatchObject({ pageLabel: "Создание сигнала", pageHref: "/exchange/new" });
    expect(field("profile.eyebrow")).toMatchObject({ pageLabel: "Профиль", pageHref: "/profile" });
    expect(field("participants.title")).toMatchObject({ pageLabel: "Сеть", pageHref: "/participants" });
    expect(field("nav.veche")).toMatchObject({ pageLabel: "Общий интерфейс" });
    expect(field("nav.veche")).not.toHaveProperty("pageHref");
    expect(field("relay.dialog_title")).toMatchObject({ pageLabel: "Диалог", pageHref: undefined });
  });

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

  it("does not persist page metadata with edited text", async () => {
    const database = new FakeDatabase();
    const form = formWithDefaults();
    form.set("exchange.title", "Обмен участниками");

    const desired = parseInterfaceTextForm(form);
    expect(Object.keys(desired)).toEqual(interfaceTextFields.map((field) => field.key));
    expect(desired["exchange.title"]).toBe("Обмен участниками");
    expect(await saveInterfaceTextsWithDatabase(database, "admin-id", desired))
      .toEqual(["exchange.title"]);
    expect([...database.overrides]).toEqual([["exchange.title", "Обмен участниками"]]);
  });

  it("saves empty and long text, preserving empty overrides instead of resetting defaults", async () => {
    const database = new FakeDatabase();
    const form = formWithDefaults();
    const longText = "Д".repeat(1200);
    form.set("home.title", "");
    form.set("exchange.lead", longText);

    expect(await saveInterfaceTextsWithDatabase(database, "admin-id", parseInterfaceTextForm(form)))
      .toEqual(["home.title", "exchange.lead"]);
    expect(database.overrides.get("home.title")).toBe("");
    expect(database.overrides.get("exchange.lead")).toBe(longText);
    const state = await readInterfaceTextsWithDatabase(database);
    expect(state.values["home.title"]).toBe("");
    expect(state.values["exchange.lead"]).toBe(longText);
  });

  it("uses the registry for new keys and ignores unregistered form and stored keys", async () => {
    const database = new FakeDatabase();
    database.overrides.set("unlisted.key", "Старая посторонняя запись");
    const field = interfaceTextFields.find((item) => item.key === "relay.messages_empty");
    expect(field).toBeDefined();
    const form = formWithDefaults();
    form.set(field!.key, "Пока нет переписки");
    form.set("unlisted.key", "Попытка изменить");

    const desired = parseInterfaceTextForm(form);
    expect(Object.keys(desired)).toEqual(interfaceTextFields.map((item) => item.key));
    expect(await saveInterfaceTextsWithDatabase(database, "admin-id", desired))
      .toEqual([field!.key]);
    expect(database.overrides.get(field!.key)).toBe("Пока нет переписки");
    expect(database.overrides.get("unlisted.key")).toBe("Старая посторонняя запись");

    const state = await readInterfaceTextsWithDatabase(database);
    expect(state.values[field!.key]).toBe("Пока нет переписки");
    expect("unlisted.key" in state.values).toBe(false);
    expect("unlisted.key" in state.overrides).toBe(false);
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

  it("overrides and restores the participants title", async () => {
    const database = new FakeDatabase();
    const form = formWithDefaults();
    form.set("participants.title", "Своя сеть");

    expect(await saveInterfaceTextsWithDatabase(database, "admin-id", parseInterfaceTextForm(form)))
      .toEqual(["participants.title"]);
    expect((await readInterfaceTextsWithDatabase(database)).values["participants.title"])
      .toBe("Своя сеть");

    form.set("reset.participants.title", "on");
    expect(await saveInterfaceTextsWithDatabase(database, "admin-id", parseInterfaceTextForm(form)))
      .toEqual(["participants.title"]);
    expect((await readInterfaceTextsWithDatabase(database)).values["participants.title"])
      .toBe("Сеть");
  });

  it("overrides and restores the profile eyebrow", async () => {
    const database = new FakeDatabase();
    const form = formWithDefaults();
    form.set("profile.eyebrow", "О себе");

    expect(await saveInterfaceTextsWithDatabase(database, "admin-id", parseInterfaceTextForm(form)))
      .toEqual(["profile.eyebrow"]);
    expect((await readInterfaceTextsWithDatabase(database)).values["profile.eyebrow"])
      .toBe("О себе");

    form.set("reset.profile.eyebrow", "on");
    expect(await saveInterfaceTextsWithDatabase(database, "admin-id", parseInterfaceTextForm(form)))
      .toEqual(["profile.eyebrow"]);
    expect((await readInterfaceTextsWithDatabase(database)).values["profile.eyebrow"])
      .toBe("Профиль");
  });
  it("saves and resets the exchange shell copy through the existing audit flow", async () => {
    const database = new FakeDatabase();
    const form = formWithDefaults();
    form.set("exchange.title", "Общий обмен");
    form.set("exchange.lead", "Новый вводный текст");
    form.set("exchange.empty", "Пока пусто.");

    expect(await saveInterfaceTextsWithDatabase(database, "admin-id", parseInterfaceTextForm(form)))
      .toEqual(["exchange.title", "exchange.lead", "exchange.empty"]);
    const state = await readInterfaceTextsWithDatabase(database);
    expect(state.values["exchange.title"]).toBe("Общий обмен");
    expect(state.values["exchange.lead"]).toBe("Новый вводный текст");
    expect(state.values["exchange.empty"]).toBe("Пока пусто.");
    expect(database.events[0].payload.keys).toEqual(["exchange.title", "exchange.lead", "exchange.empty"]);

    form.set("reset.exchange.title", "on");
    form.set("reset.exchange.lead", "on");
    form.set("reset.exchange.empty", "on");
    expect(await saveInterfaceTextsWithDatabase(database, "admin-id", parseInterfaceTextForm(form)))
      .toEqual(["exchange.title", "exchange.lead", "exchange.empty"]);
    const restored = await readInterfaceTextsWithDatabase(database);
    expect(restored.values["exchange.title"]).toBe("Обмен");
    expect(restored.values["exchange.lead"])
      .toBe("Здесь люди находят друг друга через потребности, возможности, знания, навыки, идеи и дела.");
    expect(restored.values["exchange.empty"]).toBe("Сигналов пока нет.");
  });
});
