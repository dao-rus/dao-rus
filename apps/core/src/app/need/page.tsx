import Link from "next/link";
import { isTelegramConfigured } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NeedPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [participant, params] = await Promise.all([
    getCurrentParticipant(),
    searchParams,
  ]);

  return (
    <main className="shell">
      <section className="card needCard">
        <div className="eyebrow">DAO Rus · Мне нужно</div>
        <h1>Что вам нужно?</h1>
        {participant ? (
          <>
            <p className="muted">Опишите потребность своими словами. Запись появится в вашем профиле.</p>
            {params.saved === "1" ? (
              <p className="formNotice" role="status">
                Потребность сохранена. <Link href="/profile">Посмотреть в профиле</Link>
              </p>
            ) : null}
            {params.error === "invalid" ? (
              <p className="formError" role="alert">Введите текст до 500 символов и выберите видимость.</p>
            ) : null}
            <form className="aboutForm needForm" action="/api/need" method="post">
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
                <option value="private">Только мне</option>
              </select>
              <p className="muted privacyHint">
                Это запись в профиле, а не публичное объявление или обязательство.
                Поиск совпадений пока не подключён.
              </p>
              <button className="button primary" type="submit">Сохранить</button>
            </form>
            <Link className="needProfileLink" href="/profile">Мой профиль</Link>
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
      </section>
    </main>
  );
}
