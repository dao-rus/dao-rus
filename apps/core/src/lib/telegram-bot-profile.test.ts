import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ telegramBotToken: () => "123:private-token" }));

import { downloadTelegramProfilePhoto, enrichTelegramProfile, profileAudioFromResult, profileFieldsFromChat, profilePhotoFromResult } from "./telegram-bot-profile";

afterEach(() => vi.unstubAllGlobals());

describe("Telegram Bot API profile enrichment", () => {
  it("retains only profile fields of the matching private chat", () => {
    expect(profileFieldsFromChat({ type: "private", id: 42, bio: "О себе", first_name: "Анна",
      active_usernames: ["anna"], birthdate: { day: 1, month: 2 },
      pinned_message: { text: "not a profile field" },
    }, "42")).toEqual({ bio: "О себе", first_name: "Анна", active_usernames: ["anna"], birthdate: { day: 1, month: 2 } });
    expect(profileFieldsFromChat({ type: "private", id: 99, bio: "Чужое" }, "42")).toEqual({});
  });

  it("stores current photo reference and count, not a token-bearing file URL", () => {
    expect(profilePhotoFromResult({ total_count: 2, photos: [[
      { file_id: "small", file_unique_id: "u1", width: 80, height: 80 },
      { file_id: "large", file_unique_id: "u2", width: 320, height: 320 },
    ]] })).toEqual({ photo_count: 2, photo: {
      file_id: "large", file_unique_id: "u2", width: 320, height: 320,
    } });
  });

  it("keeps only profile audio metadata, not audio content or messages", () => {
    expect(profileAudioFromResult({ total_count: 1, audios: [{
      file_id: "audio-id", file_unique_id: "audio-unique", title: "Песня", duration: 30,
      messages: ["unrelated"],
    }] })).toEqual({ profile_audio_count: 1, profile_audio: {
      file_id: "audio-id", file_unique_id: "audio-unique", title: "Песня", duration: 30,
    } });
  });

  it("keeps partial enrichment when one Bot API method fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/getChat")
        ? { ok: true, result: { type: "private", id: 42, bio: "О себе" } }
        : { ok: false },
    ), { status: 200 })));
    expect(await enrichTelegramProfile("42")).toEqual({ bio: "О себе" });
  });

  it("refreshes the file reference server-side and never returns the token URL", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { file_path: "photos/avatar.jpg" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const photo = await downloadTelegramProfilePhoto("known-file-id");
    expect(photo?.contentType).toBe("image/jpeg");
    expect(photo?.body.byteLength).toBe(3);
    expect(fetchMock.mock.calls[0][0]).toContain("getFile");
    expect(fetchMock.mock.calls[1][0]).toContain("/photos/avatar.jpg");
    expect(JSON.stringify(photo)).not.toContain("private-token");
  });
});
