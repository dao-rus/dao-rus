import { getAwardBadges } from "@/lib/award-views";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { DarusRewardCelebration } from "@/components/darus-reward-celebration";
import { PositiveExperienceFeedback } from "@/components/positive-experience-feedback";
import { TelegramAvatar } from "@/components/telegram-avatar";
import { CoreNavigation } from "../../../components/core-navigation";
import { ParticipantName } from "../../../components/participant-name";
import { getVisibleProfileAbout, residenceLabel } from "@/lib/profile-about";
import { getReputationSummary } from "@/lib/reputation";
import { getCurrentParticipant } from "@/lib/session";
import { formatDarusAmount, getVerificationRewardForFeedback } from "@/lib/tokenization";
import { getVerificationProfile } from "@/lib/verification";
import { getProfileTimeline } from "../../../lib/profile-timeline";
import { LocalDateTime } from "../../../components/local-date-time";

import { listParticipantSignals, listSignalTypes } from "../../../lib/signals";
import { readInterfaceTexts } from "../../../lib/interface-texts";
import { ProfileSignals } from "../../../components/profile-signals";
import { UserText } from "../../../components/user-text";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Профиль участника" };

type SubjectProfilePageProps = {
  params: Promise<{ participantId: string }>;
  searchParams: Promise<{ verification_action?: string; verification_reward?: string; verification_root?: string; reputation_action?: string; reputation_signal?: string }>;
};

const actionMessages: Record<string, string> = {
  created: "Ваше подтверждение сохранено.",
  revoked: "Ваше подтверждение отозвано.",
  unchanged: "Ничего не изменилось.",
  self: "Нельзя подтвердить самого себя.",
  not_verified: "Подтверждать других может только человек с подтверждённой личностью.",
  not_found: "Профиль не найден.",
  invalid: "Не удалось выполнить действие с подтверждением.",
};

const rootMessages: Record<string, string> = {
  added: "Профиль добавлен в начальное ядро доверия.",
  unchanged: "Этот профиль уже в начальном ядре доверия.",
  not_found: "Профиль не найден.",
  invalid: "Некорректный профиль.",
};

export default async function SubjectProfilePage({ params, searchParams }: SubjectProfilePageProps) {
  const viewer = await getCurrentParticipant();
  if (!viewer) redirect("/");

  const [{ participantId }, query] = await Promise.all([params, searchParams]);
  const [profile, about, signals, signalTypes, { values: texts }] = await Promise.all([
    getVerificationProfile(participantId, viewer.id),
    getVisibleProfileAbout(participantId, viewer.id, false),
    listParticipantSignals(participantId, viewer.id),
    listSignalTypes(),
    readInterfaceTexts(),
  ]);
  if (!profile) notFound();

  const [reputation, rewardAmount, timeline] = await Promise.all([
    getReputationSummary(profile.subjectId, viewer.id),
    query.verification_action === "created" && query.verification_reward
      ? getVerificationRewardForFeedback(query.verification_reward, viewer.id, profile.subjectId)
      : Promise.resolve(null),
    getProfileTimeline(profile.subjectId).catch(() => ({ joinedAt: null, leftForumAt: null, leftDaoAt: null })),
  ]);

  const awardBadges = await getAwardBadges([profile.subjectId]);
  const ownProfile = viewer.id === profile.subjectId;
  const admin = hasPrototypeAdminAccess(viewer.id);
  const formattedReward = rewardAmount ? formatDarusAmount(rewardAmount) : null;
  const actionMessage = formattedReward
    ? `Ваше подтверждение сохранено. Начислено +${formattedReward} DARUS.`
    : query.verification_action ? actionMessages[query.verification_action] : null;
  const rootMessage = query.verification_root ? rootMessages[query.verification_root] : null;
  const positiveExperienceSaved = query.reputation_signal === "positive"
    && (query.reputation_action === "created" || query.reputation_action === "changed")
    && reputation.viewerSignal === "positive";
  const reputationMessage = positiveExperienceSaved ? "Хороший опыт учтён." : query.reputation_action ? ({
    created: "Ваш опыт сохранён.",
    changed: "Ваш опыт изменён.",
    revoked: "Ваш опыт отозван.",
    unchanged: "Ничего не изменилось.",
    self: "Нельзя оценивать себя.",
    invalid: "Не удалось сохранить оценку.",
  } as Record<string, string>)[query.reputation_action] : null;

  // Before their own login a person is shown by the name they gave themselves in Telegram;
  // a roster name may be the exporter's contact label and never appears here. A profile restored
  // from the departures archive has no Telegram identity, and its name comes from public evidence.
  const shownName = profile.hasLoggedIn ? profile.displayName
    : profile.telegramOwnName ?? (!profile.hasTelegramIdentity ? profile.displayName
      : profile.telegramUsername ? `@${profile.telegramUsername}` : "Участник форума");
  const initials = shownName.replace(/^@/, "").split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase("ru-RU") ?? "").join("");
  const telegramUrl = profile.telegramUsername ? `https://t.me/${encodeURIComponent(profile.telegramUsername)}` : null;
  const showAbout = Boolean(about && (about.bio || about.residence || about.interests.length || signals.length));

  return (
    <main className="shell">
      <section className="card profile publicProfile">
        <CoreNavigation current="participants" texts={texts} />
        <div className="publicProfileHead">
          <div className="profileIdentity">
            {profile.hasLoggedIn && (profile.hasTelegramPhoto || profile.avatarUrl) ? (
              <TelegramAvatar participantId={profile.subjectId} displayName={shownName}
                avatarUrl={profile.avatarUrl} hasTelegramPhoto={profile.hasTelegramPhoto} />
            ) : <span className="profileInitials" aria-hidden="true">{initials || "·"}</span>}
            <div className="publicProfileName">
              <div className="eyebrow">{texts["profile.eyebrow"]}</div>
              <h1><ParticipantName awardBadges={awardBadges[profile.subjectId]} participantId={profile.subjectId}
                verificationPoints={profile.verificationPoints} positiveCount={reputation.positiveCount}>{shownName}</ParticipantName></h1>
              {telegramUrl && profile.telegramUsername ? <a className="publicProfileUsername" href={telegramUrl}>{`@${profile.telegramUsername}`}</a> : null}
              {!profile.hasLoggedIn ? <span className="muted publicProfileNote">{texts["profile.not_logged_in"]}</span> : null}
            </div>
          </div>

          {timeline.joinedAt || timeline.leftDaoAt || timeline.leftForumAt || about?.residence ? (
            <div className="publicProfileFacts">
              <div className="publicProfileDates">
                {timeline.joinedAt ? <span>{texts["profile.forum_since"]} <LocalDateTime dateOnly value={timeline.joinedAt.toISOString()} /></span> : null}
                {timeline.leftDaoAt ? <span>{texts["profile.left_dao"]} <LocalDateTime dateOnly value={timeline.leftDaoAt.toISOString()} /></span> : null}
                {timeline.leftForumAt ? <span>{texts["profile.left_forum"]} <LocalDateTime dateOnly value={timeline.leftForumAt.toISOString()} /></span> : null}
              </div>
              {about?.residence ? <span className="residenceLink">{residenceLabel(about.residence)}</span> : null}
            </div>
          ) : null}

          {telegramUrl && !ownProfile ? <a className="button primary publicProfileWrite" href={telegramUrl}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7z"></path></svg>
            {texts["profile.write_telegram"]}
          </a> : null}

          {profile.hasLoggedIn && profile.telegramBio ? <p className="profileBio muted">{texts["profile.telegram_bio"]}: {profile.telegramBio}</p> : null}
        </div>

        {showAbout && about ? (
          <section className="profileAbout publicAbout" aria-labelledby="public-about">
            <h2 id="public-about">О себе</h2>
            {about.bio ? <UserText className="profileBio" text={about.bio} /> : null}
            {about.interests.length ? (
              <div className="aboutBlock">
                <h3>Интересы</h3>
                <div className="interestChips">{about.interests.map((interest) => (
                  <span key={interest.id}>{interest.label}</span>
                ))}</div>
              </div>
            ) : null}
            <ProfileSignals signals={signals} types={signalTypes} texts={texts} />
          </section>
        ) : null}

        <section className="verificationCard publicTrust" aria-labelledby="public-trust">
          <h2 id="public-trust">{texts["profile.trust_title"]}</h2>

          {!ownProfile ? (
            <div className="publicTrustPart">
              <p className="publicTrustRow"><span>Хороший опыт взаимодействия:</span> <strong>{reputation.positiveCount}</strong></p>
              {reputation.viewerSignal ? <p className="muted">Ваша текущая оценка: {reputation.viewerSignal === "positive" ? "Хороший опыт взаимодействия" : "Есть проблема"}.</p> : null}
              <div className="actions">
                {reputation.viewerSignal !== "positive" ? (
                  <form action="/api/reputation" method="post">
                    <input type="hidden" name="subject_id" value={profile.subjectId} />
                    <input type="hidden" name="action" value="positive" />
                    <button className="button secondary" type="submit">{texts["profile.positive_button"]}</button>
                  </form>
                ) : null}
                {reputation.viewerSignal ? (
                  <form action="/api/reputation" method="post">
                    <input type="hidden" name="subject_id" value={profile.subjectId} />
                    <input type="hidden" name="action" value="revoke" />
                    <button className="button secondary" type="submit">Отозвать оценку</button>
                  </form>
                ) : null}
              </div>
              {reputation.viewerSignal !== "quality_flag" ? (
                <form action="/api/reputation" method="post">
                  <input type="hidden" name="subject_id" value={profile.subjectId} />
                  <input type="hidden" name="action" value="quality_flag" />
                  <button className="linkButton muted" type="submit">{texts["profile.report_problem"]}</button>
                </form>
              ) : null}
              {positiveExperienceSaved ? <PositiveExperienceFeedback /> : null}
              {reputationMessage ? <p className="formNotice" role="status">{reputationMessage}</p> : null}
            </div>
          ) : null}

          <div className="publicTrustPart">
            <p className="publicTrustRow">
              <span className={profile.isVerified ? "verificationBadge verified" : "verificationBadge"}>
                {profile.isVerified ? "✓ Личность подтверждена" : "Личность пока не подтверждена"}
              </span>
              <span className="muted">{profile.verificationPoints} подтверждений</span>
            </p>
            {profile.isRoot ? <small className="muted">В начальном ядре доверия</small> : null}
            <div className="verificationRewardAnchor">
              {!ownProfile && profile.viewerAttestationId ? (
                <form action="/api/verification/attestations" method="post">
                  <input type="hidden" name="subject_id" value={profile.subjectId} />
                  <input type="hidden" name="action" value="revoke" />
                  <button className="button secondary" type="submit">Отозвать подтверждение</button>
                </form>
              ) : null}
              {!ownProfile && !profile.viewerAttestationId && profile.viewerIsVerified ? (
                <form action="/api/verification/attestations" method="post">
                  <input type="hidden" name="subject_id" value={profile.subjectId} />
                  <input type="hidden" name="action" value="create" />
                  <button className="button secondary" type="submit">Подтвердить, что знаю этого человека</button>
                </form>
              ) : null}
              {formattedReward && query.verification_reward ? (
                <DarusRewardCelebration key={query.verification_reward}
                  entryId={query.verification_reward} amount={formattedReward} />
              ) : null}
            </div>
            {!ownProfile ? <p className="muted">{profile.viewerIsVerified
              ? "Только если можете лично узнать этого человека."
              : "Подтверждать других можно после подтверждения вашей личности."}</p> : null}
            {actionMessage ? <p className="formNotice" role="status">
              {actionMessage} {formattedReward ? <Link href="/profile/tokens">Баланс DARUS →</Link> : null}
            </p> : null}
          </div>
        </section>

        {admin && !profile.isRoot ? (
          <section className="verificationAdmin">
            <h2>Начальное ядро доверия</h2>
            <p className="muted">Первые участники, которые лично знают друг друга, становятся исходными точками подтверждения личности. От них сеть подтверждений распространяется дальше.</p>
            <form action="/api/admin/verification/roots" method="post">
              <input type="hidden" name="subject_id" value={profile.subjectId} />
              <button className="button secondary" type="submit">Добавить в начальное ядро</button>
            </form>
          </section>
        ) : null}
        {rootMessage ? <p className="formNotice">{rootMessage}</p> : null}
      </section>
    </main>
  );
}
