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
  self: "Нельзя верифицировать собственный профиль.",
  not_verified: "Создавать верификации может только верифицированный субъект.",
  not_found: "Core Subject не найден.",
  invalid: "Некорректное действие верификации.",
};

const rootMessages: Record<string, string> = {
  added: "Verification root добавлен.",
  unchanged: "Этот Core Subject уже является verification root.",
  not_found: "Core Subject не найден.",
  invalid: "Некорректный Core Subject.",
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
            <div className="eyebrow">Core Subject</div>
            <h1>{profile.displayName}</h1>
            <p className="muted mono">{profile.subjectId}</p>
          </div>
          <Link className="button secondary" href="/profile">К своему профилю</Link>
        </div>

        <section className="verificationCard">
          <div>
            <span className={profile.isVerified ? "verificationBadge verified" : "verificationBadge"}>
              {profile.isVerified ? "V · Верифицирован" : "Не верифицирован"}
            </span>
            {profile.isRoot ? <small className="muted">Verification root</small> : null}
          </div>
          <strong>{profile.verificationPoints} verification points</strong>
          <p className="muted">
            Points — активные подтверждения от субъектов, достижимых от verification roots.
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
            <p className="muted">Собственный профиль нельзя верифицировать.</p>
          ) : null}
          {actionMessage ? <p className="formNotice">{actionMessage}</p> : null}
        </section>

        {admin && !profile.isRoot ? (
          <section className="verificationAdmin">
            <h2>Bootstrap verification</h2>
            <p className="muted">
              Временное административное действие: добавить существующий Core Subject в roots.
              ADMIN_PARTICIPANT_IDS сам по себе root не создаёт.
            </p>
            <form action="/api/admin/verification/roots" method="post">
              <input type="hidden" name="subject_id" value={profile.subjectId} />
              <button className="button secondary" type="submit">Добавить в verification roots</button>
            </form>
          </section>
        ) : null}
        {rootMessage ? <p className="formNotice">{rootMessage}</p> : null}
      </section>
    </main>
  );
}
