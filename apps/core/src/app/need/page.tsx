import Link from "next/link";
import type { Metadata } from "next";
import { isTelegramConfigured } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { NeedAuthGate } from "./need-auth-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Что вам нужно?" };

export default async function NeedPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [participant, params, { values: texts }] = await Promise.all([
    getCurrentParticipant(),
    searchParams,
    readInterfaceTexts(),
  ]);

  return (
    <main className="shell">
      <section className="card needCard">
        <div className="eyebrow">DAO Rus · Мне нужно</div>
        <h1>{texts["need.title"]}</h1>
        <NeedAuthGate>
          {participant ? (
            <>
              <p className="muted">{texts["need.lead"]}</p>
              {params.saved === "1" ? (
                <div id="need-saved" className="needSavedNotice" role="status">
                  <strong>✓ Запись сохранена</strong>
                  <Link className="button secondary" href="/profile">Посмотреть в профиле</Link>
                </div>
              ) : null}
              {params.error === "invalid" ? (
                <p className="formError" role="alert">Введите текст до 500 символов и выберите видимость.</p>
              ) : null}
              <form key={params.saved === "1" ? "after-save" : "draft"} className="aboutForm needForm" action="/api/need" method="post">
                <label htmlFor="need-body">Ваша потребность</label>
                <textarea
                  id="need-body"
                  name="body"
                  maxLength={500}
                  placeholder="Мне нужно…"
                  required
                />
                <label htmlFor="need-visibility">Кому видно</label>
                <select id="need-visibility" name="visibility" defaultValue="members">
                  <option value="members">Участникам ДАО</option>
                  <option value="public">Всем</option>
                  <option value="match_only">Только при совпадении</option>
                  <option value="network_blind">Анонимно в «Нужно / есть»</option>
                  <option value="private">Только мне</option>
                </select>
                <p className="muted privacyHint">
                  Это запись в профиле, а не публичное объявление или обязательство.
                  Поиск совпадений пока не подключён. Для анонимной публикации не указывайте в тексте данные, по которым вас можно легко узнать.
                </p>
                <button className="button primary" type="submit">Сохранить</button>
              </form>
              <Link className="needProfileLink" href="/profile">Мой профиль</Link>
              {" · "}<Link href="/exchange">{texts["exchange.title"]}</Link>
            </>
          ) : (
            <>
              <p className="muted">Войдите через Telegram, чтобы сохранить потребность в DAO Core.</p>
              {isTelegramConfigured() ? (
                <a className="button primary" href="/api/auth/telegram/start?next=%2Fneed">
                  Войти через Telegram
                </a>
              ) : (
                <p className="alert">Вход через Telegram пока недоступен.</p>
              )}
            </>
          )}
        </NeedAuthGate>
      </section>
    </main>
  );
}
