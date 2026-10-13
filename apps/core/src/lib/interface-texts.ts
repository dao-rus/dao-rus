import { awardsTexts } from "./interface-text-sections/awards";
import { notificationsTexts } from "./interface-text-sections/notifications";
import { vecheTexts } from "./interface-text-sections/veche";
import { signalsTexts } from "./interface-text-sections/signals";
import { angelTexts } from "./interface-text-sections/angel";
import { guardianTexts } from "./interface-text-sections/guardian";
import { receptionTexts } from "./interface-text-sections/reception";
import { navigationTexts } from "./interface-text-sections/navigation";
import { homeTexts } from "./interface-text-sections/home";
import { networkTexts } from "./interface-text-sections/network";
import { nearbyTexts } from "./interface-text-sections/nearby";
import { communitiesTexts } from "./interface-text-sections/communities";
import { exchangeTexts } from "./interface-text-sections/exchange";
import { closerTexts } from "./interface-text-sections/closer";
import { needTexts } from "./interface-text-sections/need";
import { relayTexts } from "./interface-text-sections/relay";
import { profileTexts } from "./interface-text-sections/profile";

// Реестр собирается из файлов по разделам: порядок разделов и порядок полей внутри
// раздела определяют вид страницы «Управление → Тексты интерфейса».
const interfaceTextFieldDefinitions = [
  ...awardsTexts,
  ...notificationsTexts,
  ...vecheTexts,
  ...signalsTexts,
  ...angelTexts,
  ...guardianTexts,
  ...receptionTexts,
  ...navigationTexts,
  ...homeTexts,
  ...networkTexts,
  ...nearbyTexts,
  ...communitiesTexts,
  ...exchangeTexts,
  ...closerTexts,
  ...needTexts,
  ...relayTexts,
  ...profileTexts,
] as const;

type PageContext = { pageLabel: string; pageHref?: string };

const pageContextBySection: Record<(typeof interfaceTextFieldDefinitions)[number]["section"], PageContext> = {
  "Сигналы": { pageLabel: "Создание сигнала", pageHref: "/exchange/new" },
  "Ангел": { pageLabel: "Создание сигнала", pageHref: "/exchange/new" },
  "Хранитель": { pageLabel: "Хранитель", pageHref: "/admin/guardian" },
  "Приёмная": { pageLabel: "Анкета", pageHref: "/reception/apply" },
  "Навигация": { pageLabel: "Общий интерфейс" },
  "Главная": { pageLabel: "Главная", pageHref: "/" },
  "Сеть": { pageLabel: "Сеть", pageHref: "/participants" },
  "Уведомления": { pageLabel: "Уведомления", pageHref: "/notifications" },
  "Рядом": { pageLabel: "Рядом", pageHref: "/nearby" },
  "Сообщества": { pageLabel: "Сообщества", pageHref: "/participants" },
  "Обмен": { pageLabel: "Обмен", pageHref: "/exchange" },
  "Ближе": { pageLabel: "Обмен · Ближе", pageHref: "/exchange?type=dating" },
  "Мне нужно": { pageLabel: "Мне нужно", pageHref: "/need" },
  "Диалоги": { pageLabel: "Диалоги", pageHref: "/relay" },
  "Профиль": { pageLabel: "Профиль", pageHref: "/profile" },
  "Награды": { pageLabel: "Награды", pageHref: "/admin/awards" },
};

export const interfaceTextFields = interfaceTextFieldDefinitions.map((field) => ({
  ...pageContextBySection[field.section],
  ...field,
}));

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
    if (typeof value !== "string") {
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
      if (next === undefined) {
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
