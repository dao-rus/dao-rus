import Link from "next/link";
import { redirect } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { TelegramAvatar } from "@/components/telegram-avatar";
import { getActivitySummary } from "@/lib/activity";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { readInterfaceTexts } from "@/lib/interface-texts";
import {
  getMembershipHistory,
  membershipEventLabel,
} from "@/lib/membership-history";
import { getProfileAbout } from "@/lib/profile-about";
import { getCurrentParticipant } from "@/lib/session";
import { getDarusBalance } from "@/lib/tokenization";
import { getVerificationProfile } from "@/lib/verification";

export const dynamic = "force-dynamic";

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
  private: "Только мне",
};

const bioVisibilityOptions = ["public", "members", "private"] as const;
const matchableVisibilityOptions = ["public", "members", "match_only", "private"] as const;

type ProfilePageProps = {
  searchParams: Promise<{ profile_update?: string; about_update?: string }>;
};

const updateMessages: Record<string, string> = {
  updated: "Имя профиля обновлено.",
  unchanged: "Имя не изменилось.",
  empty_name: "Введите непустое имя.",
};

const aboutMessages: Record<string, string> = {
  updated: "Раздел «О себе» обновлён.",
  invalid: "Проверьте введённые данные.",
};

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");

  const params = await searchParams;
  const [activity, membershipHistory, verification, about, { values: texts }, darusBalance] = await Promise.all([
    getActivitySummary(participant.id),
    getMembershipHistory(participant.id),
    getVerificationProfile(participant.id, participant.id),
    getProfileAbout(participant.id),
    readInterfaceTexts(),
    getDarusBalance(participant.id),
  ]);
  const hasAdminAccess = hasPrototypeAdminAccess(participant.id);
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
            <Link className="button secondary" href="/participants">Сеть</Link>
            {hasAdminAccess ? <Link className="button secondary" href="/admin">Управление</Link> : null}
            <Link className="button secondary" href="/proposals">Предложения</Link>
            <form action="/api/auth/logout" method="post">
              <button className="button secondary" type="submit">Выйти</button>
            </form>
          </div>
        </div>

        <form className="profileEdit" action="/api/profile" method="post">
          <label htmlFor="display-name">Отображаемое имя</label>
          <div>
            <input id="display-name" name="display_name" defaultValue={participant.displayName} required />
            <button className="button primary" type="submit">Сохранить</button>
          </div>
          {updateMessage ? (
            <p className={params.profile_update === "empty_name" ? "formError" : "formNotice"}>{updateMessage}</p>
          ) : null}
        </form>

        <section className="profileAbout">
          <div className="profileSectionHeading">
            <div>
              <h2>О себе</h2>
              <p className="muted">Расскажите о себе и оставьте сигналы для будущих совпадений.</p>
            </div>
          </div>

          <form className="aboutForm" action="/api/profile/about" method="post">
            <input type="hidden" name="action" value="update_bio" />
            <label htmlFor="profile-bio">Био</label>
            <textarea id="profile-bio" name="bio" maxLength={2000} defaultValue={about?.bio ?? ""} placeholder="Несколько слов о себе" />
            <label htmlFor="bio-visibility">Кому видно</label>
            <select id="bio-visibility" name="visibility" defaultValue={about?.bioVisibility ?? "members"}>
              {bioVisibilityOptions.map((value) => <option key={value} value={value}>{visibilityLabels[value]}</option>)}
            </select>
            <button className="button primary" type="submit">Сохранить био</button>
          </form>

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
                          {matchableVisibilityOptions.map((value) => (
                            <option key={value} value={value}>{visibilityLabels[value]}</option>
                          ))}
                        </select>
                      </label>
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
            <strong>Нет данных</strong>
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
