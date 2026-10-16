import { afterEach, describe, expect, it, vi } from "vitest";
import { createReceptionProfileDraft } from "./reception-profile-draft";

const texts = { "reception.apply.button": "Заполнить анкету", "reception.apply.prefill": "Откройте анкету" };
vi.mock("./config", () => ({ telegramReceptionConfig: () => ({ token: "synthetic", miniAppEnabled: true }), appBaseUrl: () => "https://core.example" }));
vi.mock("./interface-texts", () => ({ readInterfaceTexts: async () => ({ values: texts }) }));
vi.mock("./reception-voice", () => ({ receptionApplicationButton: () => ({ text: texts["reception.apply.button"], web_app: { url: "https://core.example/reception/apply" } }) }));

function database(existing: { source_message_update_id: number; sent?: boolean; error?: string | null } | null) {
  const row = existing && { id: "draft-1", status: "draft", source_message_update_id: existing.source_message_update_id,
    draft_prompt_sent_at: existing.sent ? new Date() : null };
  const client = { query: vi.fn(async (sql: string) => {
    if (sql.startsWith("INSERT")) return { rowCount: existing ? 0 : 1, rows: [] };
    if (sql.startsWith("SELECT id")) return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    return { rowCount: 1, rows: [] };
  }), release: vi.fn() };
  return { pool: { connect: vi.fn(async () => client) } as never, client };
}

afterEach(() => vi.unstubAllGlobals());

describe("reception profile draft prompt", () => {
  it("retries an undelivered existing draft on a new message and marks success only for Telegram ok", async () => {
    const db = database({ source_message_update_id: 10, error: "telegram_unknown" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createReceptionProfileDraft("42", "Мне 51 год, живу в Пензе, работаю автослесарем", 11, db.pool);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.client.query).toHaveBeenCalledWith(expect.stringContaining("draft_prompt_sent_at=now()"), ["draft-1"]);
  });

  it("does not retry the same webhook update or an already delivered draft", async () => {
    const same = database({ source_message_update_id: 10 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await createReceptionProfileDraft("42", "Мне 51 год, живу в Пензе", 10, same.pool);
    expect(fetchMock).not.toHaveBeenCalled();

    const sent = database({ source_message_update_id: 10, sent: true });
    await createReceptionProfileDraft("42", "Мне 51 год, живу в Пензе", 11, sent.pool);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps delivery unconfirmed after a Telegram timeout", async () => {
    const db = database({ source_message_update_id: 10 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("timeout", "TimeoutError"); }));
    await createReceptionProfileDraft("42", "Мне 51 год, живу в Пензе", 11, db.pool);
    expect(db.client.query).toHaveBeenCalledWith(expect.stringContaining("draft_prompt_error_code='telegram_unknown'"), ["draft-1"]);
  });

  it("keeps delivery unconfirmed when Telegram returns ok=false", async () => {
    const db = database({ source_message_update_id: 10 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
    await createReceptionProfileDraft("42", "Мне 51 год, живу в Пензе", 11, db.pool);
    expect(db.client.query).toHaveBeenCalledWith(expect.stringContaining("draft_prompt_error_code='telegram_unknown'"), ["draft-1"]);
    expect(db.client.query).not.toHaveBeenCalledWith(expect.stringContaining("draft_prompt_sent_at=now()"), ["draft-1"]);
  });
});
