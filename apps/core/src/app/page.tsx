import Link from "next/link";
import { devAuthEnabled, isTelegramConfigured } from "@/lib/config";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const [participant, params, { values: texts }] = await Promise.all([
    getCurrentParticipant(),
    searchParams,
    readInterfaceTexts(),
  ]);
  const telegramReady = isTelegramConfigured();
  const devReady = devAuthEnabled();

  return (
    <main className="shell">
      <section className="hero card">
        <div className="eyebrow">{texts["home.eyebrow"]}</div>
        <h1>{texts["home.title"]}</h1>
        <p className="lead">{texts["home.lead"]}</p>

        {params.auth_error ? (
          <p className="alert">Не удалось войти через Telegram. Попробуйте ещё раз.</p>
        ) : null}

        {participant ? (
          <div className="actions">
            <Link className="button primary" href="/profile">
              {texts["home.profile_button"]}
            </Link>
            <Link className="button secondary" href="/participants">Сеть</Link>
            <Link className="button secondary" href="/veche">Вече</Link>
          </div>
        ) : (
          <div className="actions">
            {telegramReady ? (
              <a className="button primary" href="/api/auth/telegram/start">
                {texts["home.login_button"]}
              </a>
            ) : (
              <span className="button disabled">Telegram пока не настроен</span>
            )}

            {devReady ? (
              <form action="/api/auth/dev" method="post">
                <button className="button secondary" type="submit">
                  Пробный вход для локальной проверки
                </button>
              </form>
            ) : null}
          </div>
        )}

      </section>
    </main>
  );
}
