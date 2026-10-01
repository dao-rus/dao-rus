import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { TelegramAvatar } from "@/components/telegram-avatar";
import { getActivitySummary } from "@/lib/activity";
import { hasPrototypeAdminAccess, telegramReceptionConfig } from "@/lib/config";
import { readInterfaceTexts } from "@/lib/interface-texts";
import {
  getMembershipHistory,
  membershipEventLabel,
} from "@/lib/membership-history";
import { getProfileAbout, residenceDirectoryHref, residenceLabel } from "@/lib/profile-about";
import { getReputationSummary } from "@/lib/reputation";
import { getCurrentParticipant } from "@/lib/session";
import { getDarusBalance } from "@/lib/tokenization";
import { getVerificationProfile } from "@/lib/verification";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Мой профиль" };

const statusLabels: Record<string, string> = {
  none: "членство не установлено",
  participant: "участник",
  excluded: "исключён",
  left: "вышел",
};

const signalLabels: Record<string, string> = {
  want: "Я хочу",
  need: "Мне нужно",
  can: "Я могу",
  have: "У меня есть",
};

const signalPrompts = {
  want: "Хочу…",
  need: "Мне нужно…",
  can: "Я могу…",
  have: "У меня есть…",
} as const;

const signalKinds = ["want", "need", "can", "have"] as const;

const visibilityLabels: Record<string, string> = {
  public: "Всем",
  members: "Участникам ДАО",
  circle: "Моему кругу",
  match_only: "Только при совпадении",
  network_blind: "Анонимно в «Нужно / есть»",
  private: "Только мне",
};

const bioVisibilityOptions = ["public", "members", "private"] as const;
const matchableVisibilityOptions = ["public", "members", "match_only", "private"] as const;
const residenceTypeOptions = ["город", "п.г.т.", "деревня", "село"] as const;

type ProfilePageProps = {
  searchParams: Promise<{ profile_update?: string; about_update?: string }>;
};

const updateMessages: Record<string, string> = {
  updated: "Профиль сохранён.",
  unchanged: "Профиль не изменился.",
  empty_name: "Введите непустое имя.",
  invalid: "Проверьте введённые данные.",
};

const aboutMessages: Record<string, string> = {
  updated: "Раздел «О себе» обновлён.",
  invalid: "Проверьте введённые данные.",
};

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");

  const params = await searchParams;
  const [activity, membershipHistory, verification, about, { values: texts }, darusBalance, reputation] = await Promise.all([
    getActivitySummary(participant.id),
    getMembershipHistory(participant.id),
    getVerificationProfile(participant.id, participant.id),
    getProfileAbout(participant.id),
    readInterfaceTexts(),
    getDarusBalance(participant.id),
    getReputationSummary(participant.id, participant.id),
  ]);
  const hasAdminAccess = hasPrototypeAdminAccess(participant.id);
  const receptionConfig = telegramReceptionConfig();
  const receptionUsername = receptionConfig.token && receptionConfig.webhookSecret &&
    receptionConfig.forumChatId && receptionConfig.forumInviteUrl
    ? receptionConfig.botUsername : undefined;
  const updateMessage = params.profile_update ? updateMessages[params.profile_update] : null;
  const aboutMessage = params.about_update ? aboutMessages[params.about_update] : null;

  return (
    <main className="shell">
      <section className="card profile">
        <div className="profileHeader">
          <div className="profileIdentity">
            <TelegramAvatar participantId={participant.id} displayName={participant.displayName}
              avatarUrl={participant.avatarUrl} hasTelegramPhoto={participant.hasTelegramPhoto} />
            <div>
              <div className="eyebrow">{texts["profile.eyebrow"]}</div>
              <h1>{participant.displayName}</h1>
              <p className="muted">
                {participant.telegramUsername ? `@${participant.telegramUsername}` : "Вы вошли через Telegram"}
              </p>
              {participant.telegramName && participant.telegramName !== participant.displayName ? (
                <p className="muted">В Telegram: {participant.telegramName}</p>
              ) : null}
              {participant.telegramBio ? <p className="profileBio muted">Telegram: {participant.telegramBio}</p> : null}
            </div>
          </div>
          <div className="profileActions">
            {receptionUsername ? <a className="button secondary" href={`https://t.me/${receptionUsername}?start=core`}>
              {texts["profile.reception_link"]}
            </a> : null}
            <Link className="button secondary" href="/participants">{texts["participants.title"]}</Link>
            <Link className="button secondary" href="/exchange">{texts["exchange.title"]}</Link>
            {hasAdminAccess ? <Link className="button secondary" href="/admin">Управление</Link> : null}
            <Link className="button secondary" href="/veche">Вече</Link>
            <form action="/api/auth/logout" method="post">
              <button className="button secondary" type="submit">Выйти</button>
            </form>
          </div>
        </div>

        <form id="profile-form" className="profileEdit" action="/api/profile" method="post">
          <label htmlFor="display-name">Отображаемое имя</label>
          <div>
            <input id="display-name" name="display_name" defaultValue={participant.displayName} required />
          </div>
        </form>

        <section className="profileAbout">
          <div className="profileSectionHeading">
            <div>
              <h2>О себе</h2>
              <p className="muted">Расскажите о себе и оставьте сигналы для будущих совпадений.</p>
            </div>
          </div>

          <div className="aboutForm">
            <label htmlFor="profile-bio">Био</label>
            <textarea id="profile-bio" form="profile-form" name="bio" maxLength={2000} defaultValue={about?.bio ?? ""} placeholder="Несколько слов о себе" />
            <label htmlFor="bio-visibility">Кому видно</label>
            <select id="bio-visibility" form="profile-form" name="visibility" defaultValue={about?.bioVisibility ?? "members"}>
              {bioVisibilityOptions.map((value) => <option key={value} value={value}>{visibilityLabels[value]}</option>)}
            </select>
            <label htmlFor="residence-name">Место жительства</label>
            <div className="residenceFields">
              <input id="residence-name" form="profile-form" name="residence_name" maxLength={120}
                defaultValue={about?.residence?.name ?? ""} placeholder="Название, например Казань" />
              <select form="profile-form" name="residence_type" defaultValue={about?.residence?.type ?? "город"}
                aria-label="Тип населённого пункта">
                {about?.residence?.type && !residenceTypeOptions.some((type) => type === about.residence?.type)
                  ? <option value={about.residence.type}>{about.residence.type}</option> : null}
                {residenceTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <input form="profile-form" name="residence_country" maxLength={120}
                defaultValue={about?.residence?.country ?? "Россия"} placeholder="Страна" aria-label="Страна" />
            </div>
            <p className="muted privacyHint">Место жительства необязательно. Оставьте название пустым, если не хотите его указывать. Указанное место видно только вошедшим участникам.</p>
            <button className="button primary" type="submit" form="profile-form">Сохранить профиль</button>
            {updateMessage ? (
              <p className={params.profile_update === "empty_name" || params.profile_update === "invalid" ? "formError" : "formNotice"}>{updateMessage}</p>
            ) : null}
          </div>

          {about?.residence ? (
            <div className="aboutBlock">
              <h3>Место жительства</h3>
              <Link className="residenceLink" href={residenceDirectoryHref(about.residence)}>
                {residenceLabel(about.residence)}
              </Link>
            </div>
          ) : null}

          <div className="aboutBlock">
            <h3>Интересы</h3>
            {about?.interests.length ? (
              <ul className="profileItems">
                {about.interests.map((interest) => (
                  <li key={interest.id}>
                    <div>
                      <strong>{interest.label}</strong>
                      <small>{visibilityLabels[interest.visibility] ?? interest.visibility}</small>
                    </div>
                    <form action="/api/profile/about" method="post">
                      <input type="hidden" name="action" value="remove_interest" />
                      <input type="hidden" name="interest_id" value={interest.id} />
                      <button className="button secondary compact" type="submit">Убрать</button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Пока не указаны.</p>}
            <form className="inlineAboutForm" action="/api/profile/about" method="post">
              <input type="hidden" name="action" value="add_interest" />
              <input name="label" maxLength={80} placeholder="Например: история" required />
              <select name="visibility" defaultValue="members">
                {matchableVisibilityOptions.map((value) => <option key={value} value={value}>{visibilityLabels[value]}</option>)}
              </select>
              <button className="button secondary" type="submit">Добавить</button>
            </form>
          </div>

          <div className="aboutBlock">
            <h3>Что вы хотите, можете, ищете или готовы предложить</h3>
            <p className="muted">
              Заполните только то, что актуально. Каждый пункт можно скрыть и использовать только для будущего поиска совпадений.
            </p>
            <div className="signalEntryGrid">
              {signalKinds.map((kind) => {
                const signals = about?.signals.filter((signal) => signal.kind === kind) ?? [];
                return (
                  <section className="signalEntryCard" key={kind}>
                    <h4>{signalLabels[kind]}</h4>
                    {signals.length ? (
                      <ul className="profileItems signalItems">
                        {signals.map((signal) => (
                          <li key={signal.id}>
                            <div>
                              <strong>{signal.body}</strong>
                              <small>{visibilityLabels[signal.visibility] ?? signal.visibility}</small>
                            </div>
                            <form action="/api/profile/about" method="post">
                              <input type="hidden" name="action" value="archive_signal" />
                              <input type="hidden" name="signal_id" value={signal.id} />
                              <button className="button secondary compact" type="submit">Убрать</button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <form className="aboutForm signalForm" action="/api/profile/about" method="post">
                      <input type="hidden" name="action" value="add_signal" />
                      <input type="hidden" name="kind" value={kind} />
                      <textarea
                        name="body"
                        maxLength={500}
                        placeholder={signalPrompts[kind]}
                        aria-label={signalLabels[kind]}
                        required
                      />
                      <label>
                        Кому видно
                        <select name="visibility" defaultValue="members">
                          {(kind === "need" || kind === "have"
                            ? [...matchableVisibilityOptions, "network_blind"] : matchableVisibilityOptions
                          ).map((value) => (
                            <option key={value} value={value}>{visibilityLabels[value]}</option>
                          ))}
                        </select>
                      </label>
                      {(kind === "need" || kind === "have") ? (
                        <p className="muted privacyHint">При анонимной публикации не указывайте в тексте данные, по которым вас можно легко узнать.</p>
                      ) : null}
                      <button className="button secondary" type="submit">Добавить</button>
                    </form>
                  </section>
                );
              })}
            </div>
            <p className="muted privacyHint">
              «Только при совпадении» не публикует исходный сигнал в чужих профилях. Механизм сопоставления будет подключён отдельным этапом.
            </p>
          </div>
          {aboutMessage ? <p className={params.about_update === "invalid" ? "formError" : "formNotice"}>{aboutMessage}</p> : null}
        </section>

        <dl className="facts">
          {participant.telegramPhoneNumber ? (
            <div>
              <dt>Ваш номер в Telegram</dt>
              <dd>{participant.telegramPhoneNumber}{participant.telegramPhoneVerified === true ? " · подтверждён Telegram" : ""}</dd>
            </div>
          ) : null}
          <div>
            <dt>Подтверждение личности</dt>
            <dd><strong>{verification?.isVerified ? "✓ Личность подтверждена" : "Личность пока не подтверждена"}</strong></dd>
          </div>
          <div><dt>Статус</dt><dd>{statusLabels[participant.membershipStatus] ?? participant.membershipStatus}</dd></div>
          <div><dt>Дата регистрации</dt><dd><LocalDateTime value={participant.createdAt.toISOString()} /></dd></div>
        </dl>

        <p><Link className="metricLink" href={`/profile/${participant.id}`}>Подтверждение личности →</Link></p>

        <section className="activityHistory membershipHistory">
          <h2>История участия</h2>
          {membershipHistory.length ? (
            <ol>
              {membershipHistory.map((event) => (
                <li key={event.id}>
                  <div className="membershipHistoryEvent">
                    <strong className="membershipHistoryTitle">{membershipEventLabel(event.eventType)}</strong>
                    <span className="muted membershipHistoryTime">Когда: <LocalDateTime value={event.occurredAt.toISOString()} /></span>
                    {event.changedByParticipantId ? (
                      <small className="muted membershipHistoryAuthor">Изменил: {event.changedByDisplayName ?? event.changedByParticipantId}</small>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="muted">История участия пока не зафиксирована.</p>}
        </section>

        <div className="metrics">
          <article>
            <span>Активность</span>
            <strong>{activity.events30d} событий / 30 дней</strong>
            <small>{activity.lastActivityAt ? <>Последняя: <LocalDateTime value={activity.lastActivityAt.toISOString()} /></> : "Пока нет событий"}</small>
            <Link className="metricLink" href="/profile/activity">Подробнее →</Link>
          </article>
          <article>
            <span>Карма</span>
            <strong>Положительных сигналов: {reputation.positiveCount}</strong>
            <Link className="metricLink" href="/profile/reputation">Подробнее →</Link>
          </article>
          <article>
            <span>DARUS</span>
            <strong>{darusBalance} DARUS</strong>
            <Link className="metricLink" href="/profile/tokens">История начислений →</Link>
          </article>
        </div>
      </section>
    </main>
  );
}
