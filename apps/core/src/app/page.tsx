import Link from "next/link";
import { devAuthEnabled, isTelegramConfigured } from "@/lib/config";
import { DAO_CODE_CLAUSES } from "../lib/dao-code";
import { ActionPill } from "../components/action-pill";
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
      <section className="hero card homePage">
        <section className="homeCode" aria-labelledby="home-code-title">
          <h2 id="home-code-title">{texts["home.code_title"]}</h2>
          <ol className="homeCodeList">
            {DAO_CODE_CLAUSES.map((clause) => (
              <li key={clause.id}>{clause.text}</li>
            ))}
          </ol>
          <Link className="metricLink" href="/code">{texts["home.code_link"]}</Link>
        </section>

        <div className="homeIdentity">
          <h1>{texts["home.title"]}</h1>
          <p className="lead">{texts["home.lead"]}</p>
        </div>

        {params.auth_error ? (
          <p className="alert">Не удалось войти через Telegram. Попробуйте ещё раз.</p>
        ) : null}

        {participant ? (
          <div className="actions">
            <Link className="button primary" href="/profile">
              {texts["home.profile_button"]}
            </Link>
            <Link className="button secondary" href="/participants">{texts["participants.title"]}</Link>
            <Link className="button secondary" href="/exchange">{texts["exchange.title"]}</Link>
            <Link className="button secondary" href="/veche">{texts["nav.veche"]}</Link>
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

        <div className="homeActions">
          <ActionPill href="/profile">{texts["home.action_pill"]}</ActionPill>
        </div>
      </section>
    </main>
  );
}
