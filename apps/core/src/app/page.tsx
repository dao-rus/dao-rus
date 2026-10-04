import Link from "next/link";
import { devAuthEnabled, isTelegramConfigured } from "@/lib/config";
import { DAO_CODE_CLAUSES } from "../lib/dao-code";
import { ActionPill } from "../components/action-pill";
import { PrivateMessagesLink } from "../components/private-messages-link";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { getCurrentParticipant } from "@/lib/session";
import { getOnboardingQuests } from "@/lib/onboarding-quests";
import { formatDarusAmount } from "../lib/tokenization";
import { countUnreadNotifications } from "../lib/notifications";

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
  const [quests, unreadCount] = participant
    ? await Promise.all([getOnboardingQuests(participant.id), countUnreadNotifications(participant.id)])
    : [[], 0];

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
            <Link className="button secondary" href="/" aria-current="page">{texts["nav.home"]}</Link>
            <Link className="button secondary" href="/veche">{texts["nav.veche"]}</Link>
            <Link className="button secondary" href="/participants">{texts["participants.title"]}</Link>
            <Link className="button secondary" href="/exchange">{texts["exchange.title"]}</Link>
            <Link className="button secondary" href="/nearby">{texts["nearby.title"]}</Link>
            <PrivateMessagesLink label={texts["nav.private_messages"]} unreadCount={unreadCount} />
            <Link className="button primary" href="/profile">{texts["home.profile_button"]}</Link>
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

        {quests.length ? <div className="homeActions">
          {quests.map(quest => <ActionPill key={quest.sourceType} href={quest.href}>
            {texts[quest.textKey]} · +{formatDarusAmount(quest.amount)} DARUS
          </ActionPill>)}
        </div> : null}
      </section>
    </main>
  );
}
