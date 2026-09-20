import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { getVerificationProfile } from "@/lib/verification";

export const dynamic = "force-dynamic";

type SubjectProfilePageProps = {
  params: Promise<{ participantId: string }>;
  searchParams: Promise<{
    verification_action?: string;
    verification_root?: string;
  }>;
};

const actionMessages: Record<string, string> = {
  created: "Ваша верификация сохранена.",
  revoked: "Ваша верификация отозвана.",
  unchanged: "Состояние уже актуально; новое событие не создано.",
  self: "Нельзя подтвердить самого себя.",
  not_verified: "Создавать верификации может только верифицированный субъект.",
  not_found: "Профиль не найден.",
  invalid: "Некорректное действие верификации.",
};

const rootMessages: Record<string, string> = {
  added: "Профиль добавлен в начальное ядро доверия.",
  unchanged: "Этот профиль уже в начальном ядре доверия.",
  not_found: "Профиль не найден.",
  invalid: "Некорректный профиль.",
};

export default async function SubjectProfilePage({
  params,
  searchParams,
}: SubjectProfilePageProps) {
  const viewer = await getCurrentParticipant();
  if (!viewer) redirect("/");

  const [{ participantId }, query] = await Promise.all([params, searchParams]);
  const profile = await getVerificationProfile(participantId, viewer.id);
  if (!profile) notFound();

  const ownProfile = viewer.id === profile.subjectId;
  const admin = hasPrototypeAdminAccess(viewer.id);
  const actionMessage = query.verification_action
    ? actionMessages[query.verification_action]
    : null;
  const rootMessage = query.verification_root
    ? rootMessages[query.verification_root]
    : null;

  return (
    <main className="shell">
      <section className="card profile">
        <div className="profileHeader">
          <div>
            <div className="eyebrow">Профиль</div>
            <h1>{profile.displayName}</h1>
            <p className="muted mono">{profile.subjectId}</p>
          </div>
          <Link className="button secondary" href="/profile">К своему профилю</Link>
        </div>

        <section className="verificationCard">
          <div>
            <span className={profile.isVerified ? "verificationBadge verified" : "verificationBadge"}>
              {profile.isVerified ? "✓ Личность подтверждена" : "Личность пока не подтверждена"}
            </span>
            {profile.isRoot ? <small className="muted">В начальном ядре доверия</small> : null}
          </div>
          <strong>{profile.verificationPoints} подтверждений от других</strong>
          <p className="muted">
            Здесь учитываются подтверждения от людей, чья личность уже подтверждена в сети доверия.
          </p>

          {!ownProfile && profile.viewerAttestationId ? (
            <form action="/api/verification/attestations" method="post">
              <input type="hidden" name="subject_id" value={profile.subjectId} />
              <input type="hidden" name="action" value="revoke" />
              <button className="button secondary" type="submit">Отозвать мою верификацию</button>
            </form>
          ) : null}
          {!ownProfile && !profile.viewerAttestationId && profile.viewerIsVerified ? (
            <form action="/api/verification/attestations" method="post">
              <input type="hidden" name="subject_id" value={profile.subjectId} />
              <input type="hidden" name="action" value="create" />
              <button className="button primary" type="submit">Верифицировать</button>
            </form>
          ) : null}
          {!ownProfile && !profile.viewerIsVerified ? (
            <p className="muted">Ваш профиль пока не имеет права создавать attestations.</p>
          ) : null}
          {ownProfile ? (
            <p className="muted">Нельзя подтвердить самого себя.</p>
          ) : null}
          {actionMessage ? <p className="formNotice">{actionMessage}</p> : null}
        </section>

        {admin && !profile.isRoot ? (
          <section className="verificationAdmin">
            <h2>Начальное ядро доверия</h2>
            <p className="muted">
              Первые участники, которые лично знают друг друга, становятся исходными точками
              верификации. От них сеть подтверждений распространяется дальше.
            </p>
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
