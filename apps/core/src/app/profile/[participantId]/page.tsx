import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { DarusRewardCelebration } from "@/components/darus-reward-celebration";
import { PositiveExperienceFeedback } from "@/components/positive-experience-feedback";
import { TelegramAvatar } from "@/components/telegram-avatar";
import { ParticipantName } from "../../../components/participant-name";
import { getVisibleProfileAbout, residenceDirectoryHref, residenceLabel } from "@/lib/profile-about";
import { getReputationSummary } from "@/lib/reputation";
import { getCurrentParticipant } from "@/lib/session";
import { formatDarusAmount, getVerificationRewardForFeedback } from "@/lib/tokenization";
import { getVerificationProfile } from "@/lib/verification";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Профиль участника" };

const signalLabels: Record<string, string> = {
  want: "Я хочу",
  need: "Мне нужно",
  can: "Я могу",
  have: "У меня есть",
};

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
  const [profile, about] = await Promise.all([
    getVerificationProfile(participantId, viewer.id),
    getVisibleProfileAbout(participantId, viewer.id),
  ]);
  if (!profile) notFound();

  const [reputation, rewardAmount] = await Promise.all([
    getReputationSummary(profile.subjectId, viewer.id),
    query.verification_action === "created" && query.verification_reward
      ? getVerificationRewardForFeedback(query.verification_reward, viewer.id, profile.subjectId)
      : Promise.resolve(null),
  ]);

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

  return (
    <main className="shell">
      <section className="card profile">
        <div className="profileHeader">
          <div className="profileIdentity">
            {profile.hasLoggedIn ? (
              <TelegramAvatar participantId={profile.subjectId} displayName={profile.displayName}
                avatarUrl={profile.avatarUrl} hasTelegramPhoto={profile.hasTelegramPhoto} />
            ) : null}
            <div>
              <div className="eyebrow">Профиль</div>
              <h1>{profile.hasLoggedIn ? (
                <ParticipantName participantId={profile.subjectId}
                  verificationPoints={profile.verificationPoints} positiveCount={reputation.positiveCount}>{profile.displayName}</ParticipantName>
              ) : "Человек ещё не вошёл в Ядро"}</h1>
              {profile.hasLoggedIn && profile.telegramUsername ? <p className="muted">{`@${profile.telegramUsername}`}</p> : null}
              {profile.hasLoggedIn && profile.telegramName && profile.telegramName !== profile.displayName ? <p className="muted">В Telegram: {profile.telegramName}</p> : null}
              {profile.hasLoggedIn && profile.telegramBio ? <p className="profileBio muted">Telegram: {profile.telegramBio}</p> : null}
            </div>
          </div>
          <Link className="button secondary" href="/profile">Ваш профиль</Link>
        </div>

        {profile.hasLoggedIn && about && (about.bio || about.residence || about.interests.length || about.signals.length) ? (
          <section className="profileAbout publicAbout">
            {about.bio ? <div className="aboutBlock"><h2>О себе</h2><p className="profileBio">{about.bio}</p></div> : null}
            {about.residence ? (
              <div className="aboutBlock">
                <h3>Место жительства</h3>
                <Link className="residenceLink" href={residenceDirectoryHref(about.residence)}>
                  {residenceLabel(about.residence)}
                </Link>
              </div>
            ) : null}
            {about.interests.length ? (
              <div className="aboutBlock">
                <h3>Интересы</h3>
                <div className="interestChips">{about.interests.map((interest) => (
                  <Link key={interest.id} href={`/participants?interest=${encodeURIComponent(interest.label)}`}
                    aria-label={`Найти людей с интересом «${interest.label}»`}>{interest.label}</Link>
                ))}</div>
              </div>
            ) : null}
            {about.signals.length ? (
              <div className="aboutBlock">
                <h3>Сигналы</h3>
                <ul className="profileItems signalItems">
                  {about.signals.map((signal) => (
                    <li key={signal.id}>
                      <div>
                        <span className="signalKind">{signalLabels[signal.kind] ?? signal.kind}</span>
                        <strong>{signal.body}</strong>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="verificationCard">
          <div>
            <span className={profile.isVerified ? "verificationBadge verified" : "verificationBadge"}>
              {profile.isVerified ? "✓ Личность подтверждена" : "Личность пока не подтверждена"}
            </span>
            {profile.isRoot ? <small className="muted">В начальном ядре доверия</small> : null}
          </div>
          <strong>{profile.verificationPoints} подтверждений от других</strong>
          <p className="muted">Здесь учитываются подтверждения от людей, чья личность уже подтверждена в сети доверия.</p>
          {!ownProfile ? <p className="muted">Подтверждайте только тех, кого можете лично узнать и отличить от других.</p> : null}
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
                <button className="button primary" type="submit">Подтвердить, что знаю этого человека</button>
              </form>
            ) : null}
            {formattedReward && query.verification_reward ? (
              <DarusRewardCelebration key={query.verification_reward}
                entryId={query.verification_reward} amount={formattedReward} />
            ) : null}
          </div>
          {!ownProfile && !profile.viewerIsVerified ? <p className="muted">Подтверждать других можно после подтверждения вашей личности.</p> : null}
          {ownProfile ? <p className="muted">Нельзя подтвердить самого себя.</p> : null}
          {actionMessage ? <p className="formNotice" role="status">
            {actionMessage} {formattedReward ? <Link href="/profile/tokens">Баланс DARUS →</Link> : null}
          </p> : null}
        </section>

        {!ownProfile ? (
          <section className="verificationCard">
            <h2>Опыт взаимодействия</h2>
            <p>Хороший опыт взаимодействия: <strong>{reputation.positiveCount}</strong></p>
            <p className="muted">Ваша текущая оценка: {reputation.viewerSignal === "positive" ? "Хороший опыт взаимодействия" : reputation.viewerSignal === "quality_flag" ? "Есть проблема" : "пока нет"}.</p>
            <div className="actions">
              {reputation.viewerSignal !== "positive" ? (
                <form action="/api/reputation" method="post">
                  <input type="hidden" name="subject_id" value={profile.subjectId} />
                  <input type="hidden" name="action" value="positive" />
                  <button className="button secondary" type="submit">Хороший опыт взаимодействия</button>
                </form>
              ) : null}
              {reputation.viewerSignal !== "quality_flag" ? (
                <form action="/api/reputation" method="post">
                  <input type="hidden" name="subject_id" value={profile.subjectId} />
                  <input type="hidden" name="action" value="quality_flag" />
                  <button className="button secondary" type="submit">Есть проблема</button>
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
            {positiveExperienceSaved ? <PositiveExperienceFeedback /> : null}
            {reputationMessage ? <p className="formNotice" role="status">{reputationMessage}</p> : null}
          </section>
        ) : null}

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
