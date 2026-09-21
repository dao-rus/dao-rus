export const interfaceTextFields = [
  { key: "home.eyebrow", label: "Надпись над заголовком", defaultValue: "Ядро", multiline: false },
  { key: "home.title", label: "Заголовок", defaultValue: "ДАО Русь", multiline: false },
  {
    key: "home.lead",
    label: "Основной текст",
    defaultValue: "Пространство, где мы узнаём друг друга, сохраняем историю участия и вместе строим ДАО Русь.",
    multiline: true,
  },
  { key: "home.login_button", label: "Кнопка входа", defaultValue: "Войти через Telegram", multiline: false },
  { key: "home.profile_button", label: "Кнопка профиля", defaultValue: "Открыть профиль", multiline: false },
  { key: "participants.title", label: "Заголовок раздела «Ядро»", defaultValue: "Сеть", multiline: false },
  { key: "profile.eyebrow", label: "Надпись над именем в профиле", defaultValue: "Профиль", multiline: false },
] as const;

export type InterfaceTextKey = (typeof interfaceTextFields)[number]["key"];
export type InterfaceTextValues = Record<InterfaceTextKey, string>;
export type InterfaceTextOverrides = Record<InterfaceTextKey, string | null>;

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type InterfaceTextClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};
export type InterfaceTextDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<InterfaceTextClient>;
};

const keys = interfaceTextFields.map((field) => field.key);

export class InterfaceTextValidationError extends Error {
  constructor() {
    super("Invalid interface text");
    this.name = "InterfaceTextValidationError";
  }
}

export async function readInterfaceTextsWithDatabase(
  database: Pick<InterfaceTextDatabase, "query">,
): Promise<{ values: InterfaceTextValues; overrides: InterfaceTextOverrides }> {
  const values = Object.fromEntries(
    interfaceTextFields.map((field) => [field.key, field.defaultValue]),
  ) as InterfaceTextValues;
  const overrides = Object.fromEntries(
    interfaceTextFields.map((field) => [field.key, null]),
  ) as InterfaceTextOverrides;
  const result = await database.query(
    "SELECT key, value FROM ui_text_overrides WHERE key = ANY($1::text[])",
    [keys],
  );
  for (const row of result.rows) {
    if (!keys.includes(row.key as InterfaceTextKey)) continue;
    const key = row.key as InterfaceTextKey;
    const value = String(row.value);
    values[key] = value;
    overrides[key] = value;
  }
  return { values, overrides };
}

export async function readInterfaceTexts() {
  const { pool } = await import("./db");
  return readInterfaceTextsWithDatabase(pool);
}

export function parseInterfaceTextForm(formData: FormData): InterfaceTextOverrides {
  const overrides = {} as InterfaceTextOverrides;
  for (const field of interfaceTextFields) {
    if (formData.get(`reset.${field.key}`) === "on") {
      overrides[field.key] = null;
      continue;
    }
    const value = formData.get(field.key);
    if (typeof value !== "string" || !value.trim() || value.trim().length > 1000) {
      throw new InterfaceTextValidationError();
    }
    const normalized = value.trim();
    overrides[field.key] = normalized === field.defaultValue ? null : normalized;
  }
  return overrides;
}

export async function saveInterfaceTextsWithDatabase(
  database: Pick<InterfaceTextDatabase, "connect">,
  actorId: string,
  desired: InterfaceTextOverrides,
): Promise<InterfaceTextKey[]> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE ui_text_overrides IN SHARE ROW EXCLUSIVE MODE");
    const currentResult = await client.query(
      "SELECT key, value FROM ui_text_overrides WHERE key = ANY($1::text[])",
      [keys],
    );
    const current = new Map(currentResult.rows.map((row) => [String(row.key), String(row.value)]));
    const changedKeys: InterfaceTextKey[] = [];

    for (const field of interfaceTextFields) {
      const next = desired[field.key];
      if (next === undefined || (next !== null && (!next.trim() || next.length > 1000))) {
        throw new InterfaceTextValidationError();
      }
      const previous = current.get(field.key) ?? null;
      if (previous === next) continue;
      if (next === null) {
        await client.query("DELETE FROM ui_text_overrides WHERE key = $1", [field.key]);
      } else {
        await client.query(
          `INSERT INTO ui_text_overrides(key, value)
           VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_at = now()`,
          [field.key, next],
        );
      }
      changedKeys.push(field.key);
    }

    if (changedKeys.length) {
      await client.query(
        `INSERT INTO events(event_type, participant_id, payload)
         VALUES ('interface.texts_updated', $1, $2::jsonb)`,
        [actorId, JSON.stringify({ changed_by_participant_id: actorId, keys: changedKeys })],
      );
    }
    await client.query("COMMIT");
    return changedKeys;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function saveInterfaceTexts(actorId: string, desired: InterfaceTextOverrides) {
  const { pool } = await import("./db");
  return saveInterfaceTextsWithDatabase(pool, actorId, desired);
}
