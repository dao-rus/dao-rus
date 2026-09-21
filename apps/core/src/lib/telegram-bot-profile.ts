import { telegramBotToken } from "./config";

type BotResult = { ok?: boolean; result?: unknown };

async function botApi(method: string, params: Record<string, string | number>): Promise<unknown | null> {
  const token = telegramBotToken();
  if (!token) return null;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as BotResult;
    return data.ok ? data.result ?? null : null;
  } catch {
    return null;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function profileFieldsFromChat(value: unknown, telegramUserId: string): Record<string, unknown> {
  const chat = object(value);
  if (!chat || chat.type !== "private" || String(chat.id) !== telegramUserId) return {};
  const fields: Record<string, unknown> = {};
  for (const key of [
    "bio", "username", "first_name", "last_name", "emoji_status_custom_emoji_id",
    "profile_background_custom_emoji_id",
  ] as const) {
    const text = string(chat[key]);
    if (text) fields[key] = text;
  }
  for (const key of ["emoji_status_expiration_date", "profile_accent_color_id"] as const) {
    if (Number.isInteger(chat[key])) fields[key] = chat[key];
  }
  if (Array.isArray(chat.active_usernames)) {
    const names = chat.active_usernames.filter((name): name is string => Boolean(string(name)));
    if (names.length) fields.active_usernames = names;
  }
  const birthdate = object(chat.birthdate);
  if (birthdate && Number.isInteger(birthdate.day) && Number.isInteger(birthdate.month)) {
    fields.birthdate = {
      day: birthdate.day,
      month: birthdate.month,
      ...(Number.isInteger(birthdate.year) ? { year: birthdate.year } : {}),
    };
  }
  const intro = object(chat.business_intro);
  if (intro) {
    const title = string(intro.title);
    const message = string(intro.message);
    if (title || message) fields.business_intro = { ...(title ? { title } : {}), ...(message ? { message } : {}) };
  }
  const location = object(chat.business_location);
  const address = location && string(location.address);
  const coordinates = location && object(location.location);
  if (address) fields.business_location = {
    address,
    ...(coordinates && typeof coordinates.latitude === "number" && typeof coordinates.longitude === "number"
      ? { location: { latitude: coordinates.latitude, longitude: coordinates.longitude } } : {}),
  };
  const hours = object(chat.business_opening_hours);
  const timeZone = hours && string(hours.time_zone_name);
  if (timeZone && Array.isArray(hours?.opening_hours)) {
    fields.business_opening_hours = {
      time_zone_name: timeZone,
      opening_hours: hours.opening_hours.flatMap((value) => {
        const interval = object(value);
        return interval && Number.isInteger(interval.opening_minute) && Number.isInteger(interval.closing_minute)
          ? [{ opening_minute: interval.opening_minute, closing_minute: interval.closing_minute }]
          : [];
      }),
    };
  }
  const personalChat = object(chat.personal_chat);
  if (personalChat && (typeof personalChat.id === "number" || typeof personalChat.id === "string")) {
    fields.personal_chat = {
      id: String(personalChat.id),
      ...(string(personalChat.title) ? { title: personalChat.title } : {}),
      ...(string(personalChat.username) ? { username: personalChat.username } : {}),
    };
  }
  const chatPhoto = object(chat.photo);
  const chatFileId = chatPhoto && (string(chatPhoto.big_file_id) || string(chatPhoto.small_file_id));
  const chatUniqueId = chatPhoto && (string(chatPhoto.big_file_unique_id) || string(chatPhoto.small_file_unique_id));
  if (chatFileId && chatUniqueId) fields.photo = { file_id: chatFileId, file_unique_id: chatUniqueId };
  return fields;
}

export function profilePhotoFromResult(value: unknown): Record<string, unknown> {
  const photos = object(value);
  if (!photos || !Number.isInteger(photos.total_count) || !Array.isArray(photos.photos)) return {};
  const firstPhoto = photos.photos[0];
  const sizes = Array.isArray(firstPhoto) ? firstPhoto : [];
  const largest = object(sizes.at(-1));
  const fileId = largest && string(largest.file_id);
  const uniqueId = largest && string(largest.file_unique_id);
  const result: Record<string, unknown> = { photo_count: photos.total_count };
  if (fileId && uniqueId) {
    result.photo = {
      file_id: fileId,
      file_unique_id: uniqueId,
      ...(Number.isInteger(largest.width) ? { width: largest.width } : {}),
      ...(Number.isInteger(largest.height) ? { height: largest.height } : {}),
      ...(Number.isInteger(largest.file_size) ? { file_size: largest.file_size } : {}),
    };
  }
  return result;
}

export function profileAudioFromResult(value: unknown): Record<string, unknown> {
  const audios = object(value);
  if (!audios || !Number.isInteger(audios.total_count) || !Array.isArray(audios.audios)) return {};
  const result: Record<string, unknown> = { profile_audio_count: audios.total_count };
  const first = object(audios.audios[0]);
  if (!first || !string(first.file_id) || !string(first.file_unique_id)) return result;
  result.profile_audio = {
    file_id: first.file_id,
    file_unique_id: first.file_unique_id,
    ...(string(first.title) ? { title: first.title } : {}),
    ...(string(first.performer) ? { performer: first.performer } : {}),
    ...(Number.isInteger(first.duration) ? { duration: first.duration } : {}),
  };
  return result;
}

export async function enrichTelegramProfile(telegramUserId: string): Promise<Record<string, unknown>> {
  if (!/^\d+$/.test(telegramUserId) || !Number.isSafeInteger(Number(telegramUserId))) return {};
  if (!telegramBotToken()) return {};
  const userId = Number(telegramUserId);
  const [chat, photos, audios] = await Promise.all([
    botApi("getChat", { chat_id: userId }),
    botApi("getUserProfilePhotos", { user_id: userId, offset: 0, limit: 1 }),
    botApi("getUserProfileAudios", { user_id: userId, offset: 0, limit: 1 }),
  ]);
  return {
    ...profileFieldsFromChat(chat, telegramUserId),
    ...profilePhotoFromResult(photos),
    ...profileAudioFromResult(audios),
  };
}

export async function downloadTelegramProfilePhoto(fileId: string): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const file = object(await botApi("getFile", { file_id: fileId }));
  const path = file && string(file.file_path);
  const token = telegramBotToken();
  if (!path || !token || path.includes("..") || !/^[A-Za-z0-9_./-]+$/.test(path)) return null;
  try {
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    if (Number(response.headers.get("content-length") ?? 0) > 5_000_000) return null;
    const body = await response.arrayBuffer();
    return body.byteLength <= 5_000_000 ? { body, contentType } : null;
  } catch {
    return null;
  }
}
