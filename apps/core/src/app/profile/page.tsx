import { getOwnAwardOffers, getAwardBadges } from "@/lib/award-views";
import { hasAnyAdminSection } from "../../lib/admin-access";
import { OwnAwards, AwardNotice } from "../../components/award-content";
import { ParticipantName } from "../../components/participant-name";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { CoreNavigation } from "../../components/core-navigation";
import { TelegramAvatar } from "@/components/telegram-avatar";
import { getActivitySummary } from "@/lib/activity";
import { readInterfaceTexts } from "@/lib/interface-texts";
import {
  getMembershipHistory,
  membershipEventLabel,
} from "@/lib/membership-history";
import { getProfileAbout, residenceDirectoryHref, residenceLabel } from "@/lib/profile-about";
import { isParticipantsDirectoryEnabled } from "@/lib/config";
import { getReputationSummary } from "@/lib/reputation";
import { getCurrentParticipant } from "@/lib/session";
import { getForumJoinDate } from "@/lib/forum-join-history";
import { formatDarusAmount, getDarusBalance } from "@/lib/tokenization";
import { getVerificationProfile, verificationConfirmationLabel } from "@/lib/verification";
import { getOnboardingRewardFeedback } from "../../lib/onboarding-quests";

import { listParticipantSignals, listSignalTypes } from "../../lib/signals";
import { ProfileSignals } from "../../components/profile-signals";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Мой профиль" };

const statusLabels: Record<string, string> = {
  none: "членство не установлено",
  participant: "участник",
  excluded: "исключён",
  left: "вышел",
};

const visibilityLabels: Record<string, string> = {
  public: "Всем",
  members: "Вошедшим в Ядро",
  circle: "Моему кругу (пока скрыто)",
  match_only: "Только при совпадении (пока скрыто)",
  network_blind: "Анонимно в «Нужно / есть»",
  private: "Только мне",
};

const bioVisibilityOptions = ["public", "members", "private"] as const;
// Circle and match-only access rules are not yet implemented for interests.
const interestVisibilityOptions = ["public", "members", "private"] as const;
const residenceTypeOptions = ["город", "п.г.т.", "деревня", "село"] as const;

type ProfilePageProps = {
  searchParams: Promise<{ profile_update?: string; about_update?: string; award_update?: string; onboarding_reward?: string }>;
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
  duplicate_interest: "Такой интерес уже указан. Измените существующую запись.",
  duplicate_resource: "Эта ссылка уже добавлена.",
};

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const directoryEnabled = isParticipantsDirectoryEnabled();

  const params = await searchParams;
  const onboardingReward = await getOnboardingRewardFeedback(participant.id, params.onboarding_reward);
  const [activity, membershipHistory, verification, about, { values: texts }, darusBalance, reputation, signals, signalTypes, forumJoinedAt] = await Promise.all([
    getActivitySummary(participant.id),
    getMembershipHistory(participant.id),
    getVerificationProfile(participant.id, participant.id),
    getProfileAbout(participant.id, false),
    readInterfaceTexts(),
    getDarusBalance(participant.id),
    getReputationSummary(participant.id, participant.id),
    listParticipantSignals(participant.id, participant.id),
    listSignalTypes(),
    getForumJoinDate(participant.id).catch(() => null),
  ]);
  const forumAnnouncement = await import("../../lib/newcomer-announcement")
    .then((module) => module.readForumAnnouncementChoice(participant.id)).catch(() => null);
  const [awardOffers, awardBadges] = await Promise.all([getOwnAwardOffers(participant.id), getAwardBadges([participant.id])]);
  const hasAdminAccess = hasAnyAdminSection(participant.id);
  const updateMessage = params.profile_update ? updateMessages[params.profile_update] : null;
  const aboutMessage = params.about_update ? aboutMessages[params.about_update] : null;

  return (
    <main className="shell">
      <section className="card profile">
        <CoreNavigation current="profile" texts={texts} />
        {onboardingReward ? <p className="formNotice" role="status">{onboardingReward}</p> : null}
        <div className="profileHeader">
          <div className="profileIdentity">
            <TelegramAvatar participantId={participant.id} displayName={participant.displayName}
              avatarUrl={participant.avatarUrl} hasTelegramPhoto={participant.hasTelegramPhoto} />
            <div>
              <div className="eyebrow">{texts["profile.eyebrow"]}</div>
              <h1><ParticipantName participantId={participant.id} verificationPoints={verification?.verificationPoints ?? 0} positiveCount={reputation.positiveCount} awardBadges={awardBadges[participant.id]}>{participant.displayName}</ParticipantName></h1>
              <p className="muted">
                {participant.telegramUsername ? `@${participant.telegramUsername}` : "Вы вошли через Telegram"}
              </p>
              {participant.telegramName && participant.telegramName !== participant.displayName ? (
                <p className="muted">В Telegram: {participant.telegramName}</p>
              ) : null}
              {participant.telegramBio ? <p className="profileBio muted">Биография из Telegram (не публикуется в Ядре): {participant.telegramBio}</p> : null}
            </div>
          </div>
          <div className="profileActions">
            {hasAdminAccess ? <Link className="button secondary" href="/admin">Управление</Link> : null}
            <form action="/api/auth/logout" method="post">
              <button className="button secondary" type="submit">Выйти</button>
            </form>
          </div>
        </div>

        <AwardNotice notice={params.award_update} texts={texts}/><OwnAwards offers={awardOffers} texts={texts}/>
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
              <p className="muted">Расскажите о себе и оставьте записи для будущих совпадений.</p>
            </div>
          </div>

          <div className="aboutForm">
            <label htmlFor="profile-bio">Био</label>
            <textarea id="profile-bio" form="profile-form" name="bio" maxLength={2000} defaultValue={about?.bio ?? ""} placeholder="Несколько слов о себе" />
            <label htmlFor="bio-visibility">Кому видно</label>
            <select id="bio-visibility" form="profile-form" name="visibility" defaultValue={about?.bioVisibility ?? "members"}>
              {about?.bioVisibility && !bioVisibilityOptions.some((value) => value === about.bioVisibility) ? (
                <option value={about.bioVisibility}>{visibilityLabels[about.bioVisibility] ?? about.bioVisibility}</option>
              ) : null}
              {bioVisibilityOptions.map((value) => <option key={value} value={value}>{visibilityLabels[value]}</option>)}
            </select>
            <p className="muted privacyHint">«Вошедшим в Ядро» — всем авторизованным пользователям, независимо от членства. «Всем» не открывает профиль без входа. Ранее выбранные режимы «Моему кругу» и «Только при совпадении» сохраняются, но пока скрыты от других.</p>
            <label htmlFor="residence-name">Место жительства</label>
            <div className="residenceFields">
              <input id="residence-name" form="profile-form" name="residence_name" maxLength={200}
                defaultValue={about?.city ?? ""} placeholder="Название, например Казань" />
              <select form="profile-form" name="residence_type" defaultValue={about?.residence?.type ?? ""}
                aria-label="Тип населённого пункта">
                <option value="">Тип не указан</option>
                {about?.residence?.type && !residenceTypeOptions.some((type) => type === about.residence?.type)
                  ? <option value={about.residence.type}>{about.residence.type}</option> : null}
                {residenceTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <input form="profile-form" name="residence_country" maxLength={120}
                defaultValue={about?.residence?.country ?? ""} placeholder="Страна" aria-label="Страна" />
            </div>
            <p className="muted privacyHint">Город и род занятий, которые вы указали, видны всем пользователям Core. Тип населённого пункта и страна нужны только для точной географической привязки.</p>
            {(about?.age || about?.city || about?.occupation || about?.education || about?.familyStatus) ? <dl className="facts">
              {about.age ? <div><dt>Возраст</dt><dd>{about.age}</dd></div> : null}
              {about.city ? <div><dt>Город</dt><dd>{about.city}</dd></div> : null}
              {about.occupation ? <div><dt>Род занятий</dt><dd>{about.occupation}</dd></div> : null}
              {about.education ? <div><dt>Образование</dt><dd>{about.education}</dd></div> : null}
              {about.familyStatus ? <div><dt>Семейное положение</dt><dd>{about.familyStatus}</dd></div> : null}
            </dl> : null}
            {forumAnnouncement ? <label className="interfaceReset">
              <input type="hidden" form="profile-form" name="announce_in_forum_present" value="1" />
              <input type="checkbox" form="profile-form" name="announce_in_forum" defaultChecked={forumAnnouncement.announce} />
              {texts["profile.announce_in_forum"]}
            </label> : null}
            <button className="button primary" type="submit" form="profile-form">Сохранить профиль</button>
            {updateMessage ? (
              <p className={params.profile_update === "empty_name" || params.profile_update === "invalid" ? "formError" : "formNotice"}>{updateMessage}</p>
            ) : null}
          </div>

          {about?.residence ? (
            <div className="aboutBlock">
              <h3>Место жительства</h3>
              {directoryEnabled ? <Link className="residenceLink" href={residenceDirectoryHref(about.residence)}>{residenceLabel(about.residence)}</Link>
                : <span className="residenceLink">{residenceLabel(about.residence)}</span>}
            </div>
          ) : null}

          <div className="aboutBlock">
            <h3 id="profile-interests">Интересы</h3>
            {about?.interests.length ? (
              <ul className="profileItems">
                {about.interests.map((interest) => (
                  <li key={interest.id}>
                    <div className="profileInterestContent">
                      <strong>{interest.label}</strong>
                      <small>{visibilityLabels[interest.visibility] ?? interest.visibility}</small>
                      <details className="profileInterestDetails">
                        <summary>Изменить</summary>
                        <form className="inlineAboutForm" action="/api/profile/about" method="post">
                          <input type="hidden" name="action" value="update_interest" />
                          <input type="hidden" name="interest_id" value={interest.id} />
                          <input name="label" aria-label="Название интереса" maxLength={80} defaultValue={interest.label} required />
                          <select name="visibility" aria-label="Кому виден интерес" defaultValue={interest.visibility}>
                            {!interestVisibilityOptions.some((value) => value === interest.visibility) ? (
                              <option value={interest.visibility}>{visibilityLabels[interest.visibility] ?? interest.visibility}</option>
                            ) : null}
                            {interestVisibilityOptions.map((value) => <option key={value} value={value}>{visibilityLabels[value]}</option>)}
                          </select>
                          <button className="button secondary compact" type="submit">Сохранить</button>
                        </form>
                      </details>
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
                {interestVisibilityOptions.map((value) => <option key={value} value={value}>{visibilityLabels[value]}</option>)}
              </select>
              <button className="button secondary" type="submit">Добавить</button>
            </form>
          </div>

          <div className="aboutBlock">
            <h3>Мои ресурсы в сети</h3>
            {about?.resources?.length ? <ul className="profileItems">
              {about.resources.map((resource) => <li key={resource.id}>
                <a href={resource.url} target="_blank" rel="noreferrer">{resource.url}</a>
                <form action="/api/profile/about" method="post">
                  <input type="hidden" name="action" value="remove_resource" />
                  <input type="hidden" name="resource_id" value={resource.id} />
                  <button className="button secondary compact" type="submit">Удалить</button>
                </form>
              </li>)}
            </ul> : <p className="muted">Пока не добавлены.</p>}
            <form className="inlineAboutForm" action="/api/profile/about" method="post">
              <input type="hidden" name="action" value="add_resource" />
              <input name="url" type="url" inputMode="url" maxLength={2048} placeholder="https://…" aria-label="Ссылка на ресурс" required />
              <button className="button secondary" type="submit">Добавить</button>
            </form>
          </div>

          <ProfileSignals signals={signals} types={signalTypes} texts={texts} owner />
          {aboutMessage ? <p className={params.about_update === "invalid" || params.about_update === "duplicate_interest" || params.about_update === "duplicate_resource" ? "formError" : "formNotice"} role={params.about_update === "invalid" || params.about_update === "duplicate_interest" || params.about_update === "duplicate_resource" ? "alert" : "status"}>{aboutMessage}</p> : null}
        </section>

        <dl className="facts">
          {participant.telegramPhoneNumber ? (
            <div>
              <dt>Ваш номер в Telegram</dt>
              <dd>{participant.telegramPhoneNumber}{participant.telegramPhoneVerified === true ? " · подтверждён Telegram" : ""}</dd>
            </div>
          ) : null}
          <div>
            <dt>Подтверждения знакомства</dt>
            <dd><strong>{verificationConfirmationLabel(verification?.verificationPoints ?? 0)}</strong></dd>
          </div>
          <div><dt>Статус</dt><dd>{statusLabels[participant.membershipStatus] ?? participant.membershipStatus}</dd></div>
          {forumJoinedAt
            ? <div><dt>{texts["profile.forum_since"]}</dt><dd><LocalDateTime dateOnly value={forumJoinedAt.toISOString()} /></dd></div>
            : <div><dt>Дата регистрации</dt><dd><LocalDateTime value={participant.createdAt.toISOString()} /></dd></div>}
        </dl>

        <p><Link className="metricLink" href={`/profile/${participant.id}`}>Мои подтверждения и доверие →</Link></p>

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
            <strong>{formatDarusAmount(darusBalance)} DARUS</strong>
            <Link className="metricLink" href="/profile/tokens">История начислений →</Link>
          </article>
        </div>
      </section>
    </main>
  );
}
