export const interfaceTextFields = [
  { section: "Главная", key: "home.eyebrow", label: "Надпись над заголовком", defaultValue: "Ядро", multiline: false },
  { section: "Главная", key: "home.title", label: "Заголовок", defaultValue: "ДАО Русь", multiline: false },
  {
    section: "Главная",
    key: "home.lead",
    label: "Основной текст",
    defaultValue: "Пространство, где мы узнаём друг друга, сохраняем историю участия и вместе строим ДАО Русь.",
    multiline: true,
  },
  { section: "Главная", key: "home.login_button", label: "Кнопка входа", defaultValue: "Войти через Telegram", multiline: false },
  { section: "Главная", key: "home.profile_button", label: "Кнопка профиля", defaultValue: "Ваш профиль", multiline: false },
  { section: "Главная", key: "home.code_link", label: "Ссылка на Кодекс", defaultValue: "Открыть Кодекс →", multiline: false },
  { section: "Сеть", key: "participants.title", label: "Заголовок", defaultValue: "Сеть", multiline: false },
  { section: "Сеть", key: "participants.sort_label", label: "Подпись сортировки", defaultValue: "Сортировка:", multiline: false },
  { section: "Сеть", key: "participants.sort_name", label: "Сортировка по имени", defaultValue: "Имя", multiline: false },
  { section: "Сеть", key: "participants.sort_verification", label: "Сортировка по верификации", defaultValue: "Топ-верификация", multiline: false },
  { section: "Сеть", key: "participants.sort_reputation", label: "Сортировка по репутации", defaultValue: "Топ-репутация", multiline: false },
  { section: "Сообщества", key: "community.residence_title", label: "Заголовок сообщества места", defaultValue: "Сообщество места", multiline: false },
  { section: "Сообщества", key: "community.interest_title", label: "Заголовок сообщества интереса", defaultValue: "Сообщество интереса", multiline: false },
  { section: "Сообщества", key: "community.members_title", label: "Заголовок списка участников", defaultValue: "Участники", multiline: false },
  { section: "Сообщества", key: "community.feed_title", label: "Заголовок ленты", defaultValue: "Объявления сообщества", multiline: false },
  { section: "Сообщества", key: "community.feed_empty", label: "Пустая лента", defaultValue: "Объявлений пока нет.", multiline: false },
  { section: "Нужно / есть", key: "exchange.title", label: "Заголовок", defaultValue: "Нужно / есть", multiline: false },
  { section: "Нужно / есть", key: "exchange.lead", label: "Вводный текст", defaultValue: "Сначала — дело, потом — знакомство. Контакты открываются только по взаимному согласию.", multiline: true },
  { section: "Нужно / есть", key: "exchange.empty", label: "Пустой список сигналов", defaultValue: "Сигналов пока нет.", multiline: false },
  { section: "Мне нужно", key: "need.title", label: "Заголовок", defaultValue: "Что вам нужно?", multiline: false },
  { section: "Мне нужно", key: "need.lead", label: "Вводный текст", defaultValue: "Опишите потребность своими словами. Запись появится в вашем профиле.", multiline: true },
  { section: "Диалоги", key: "relay.list_title", label: "Заголовок списка", defaultValue: "Диалоги", multiline: false },
  { section: "Диалоги", key: "relay.archive_title", label: "Заголовок архива", defaultValue: "Архив диалогов", multiline: false },
  { section: "Диалоги", key: "relay.dialog_title", label: "Заголовок диалога", defaultValue: "Диалог", multiline: false },
  { section: "Диалоги", key: "relay.list_empty", label: "Пустой список диалогов", defaultValue: "Активных диалогов пока нет.", multiline: false },
  { section: "Диалоги", key: "relay.archive_empty", label: "Пустой архив", defaultValue: "Архив пуст.", multiline: false },
  { section: "Диалоги", key: "relay.messages_empty", label: "Пустая переписка", defaultValue: "Сообщений пока нет.", multiline: false },
  { section: "Профиль", key: "profile.eyebrow", label: "Надпись над именем в профиле", defaultValue: "Профиль", multiline: false },
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
