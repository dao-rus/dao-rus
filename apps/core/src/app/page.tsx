import Link from "next/link";
import { devAuthEnabled, isTelegramConfigured } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const participant = await getCurrentParticipant();
  const params = await searchParams;
  const telegramReady = isTelegramConfigured();
  const devReady = devAuthEnabled();

  return (
    <main className="shell">
      <section className="hero card">
        <div className="eyebrow">Ядро</div>
        <h1>ДАО Русь</h1>
        <p className="lead">
          Пространство, где мы узнаём друг друга, сохраняем историю участия и вместе строим ДАО Русь.
        </p>

        {params.auth_error ? (
          <p className="alert">Не удалось войти через Telegram. Попробуйте ещё раз.</p>
        ) : null}

        {participant ? (
          <div className="actions">
            <Link className="button primary" href="/profile">
              Открыть профиль
            </Link>
          </div>
        ) : (
          <div className="actions">
            {telegramReady ? (
              <a className="button primary" href="/api/auth/telegram/start">
                Войти через Telegram
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
