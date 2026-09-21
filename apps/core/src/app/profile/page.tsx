import Link from "next/link";
import { redirect } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { getActivitySummary } from "@/lib/activity";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { readInterfaceTexts } from "@/lib/interface-texts";
import {
  getMembershipHistory,
  membershipEventLabel,
} from "@/lib/membership-history";
import { getCurrentParticipant } from "@/lib/session";
import { getVerificationProfile } from "@/lib/verification";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  none: "членство не установлено",
  participant: "участник",
  excluded: "исключён",
  left: "вышел",
};

type ProfilePageProps = {
  searchParams: Promise<{ profile_update?: string }>;
};

const updateMessages: Record<string, string> = {
  updated: "Имя профиля обновлено.",
  unchanged: "Имя не изменилось.",
  empty_name: "Введите непустое имя.",
};

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");

  const params = await searchParams;
  const [activity, membershipHistory, verification, { values: texts }] = await Promise.all([
    getActivitySummary(participant.id),
    getMembershipHistory(participant.id),
    getVerificationProfile(participant.id, participant.id),
    readInterfaceTexts(),
  ]);
  const hasAdminAccess = hasPrototypeAdminAccess(participant.id);
  const updateMessage = params.profile_update
    ? updateMessages[params.profile_update]
    : null;

  return (
    <main className="shell">
      <section className="card profile">
        <div className="profileHeader">
          <div>
            <div className="eyebrow">{texts["profile.eyebrow"]}</div>
            <h1>{participant.displayName}</h1>
            <p className="muted">
              {participant.telegramUsername
                ? `@${participant.telegramUsername}`
                : "Вы вошли через Telegram"}
            </p>
          </div>
          <div className="profileActions">
            <Link className="button secondary" href="/participants">
              Сеть
            </Link>
            {hasAdminAccess ? (
              <>
                <Link className="button secondary" href="/admin/participants">
                  Реестр ДАО
                </Link>
                <Link className="button secondary" href="/admin/interface">
                  Тексты интерфейса
                </Link>
              </>
            ) : null}
            <Link className="button secondary" href="/proposals">
              Предложения
            </Link>
            <form action="/api/auth/logout" method="post">
              <button className="button secondary" type="submit">
                Выйти
              </button>
            </form>
          </div>
        </div>

        <form className="profileEdit" action="/api/profile" method="post">
          <label htmlFor="display-name">Отображаемое имя</label>
          <div>
            <input
              id="display-name"
              name="display_name"
              defaultValue={participant.displayName}
              required
            />
            <button className="button primary" type="submit">
              Сохранить
            </button>
          </div>
          {updateMessage ? (
            <p className={params.profile_update === "empty_name" ? "formError" : "formNotice"}>
              {updateMessage}
            </p>
          ) : null}
        </form>

        <dl className="facts">
          <div>
            <dt>Подтверждение личности</dt>
            <dd>
              <strong>
                {verification?.isVerified ? "✓ Личность подтверждена" : "Личность пока не подтверждена"}
              </strong>
            </dd>
          </div>
          <div>
            <dt>Статус</dt>
            <dd>{statusLabels[participant.membershipStatus] ?? participant.membershipStatus}</dd>
          </div>
          <div>
            <dt>Дата регистрации</dt>
            <dd>
              <LocalDateTime value={participant.createdAt.toISOString()} />
            </dd>
          </div>
        </dl>

        <p>
          <Link className="metricLink" href={`/profile/${participant.id}`}>
            Подтверждение личности →
          </Link>
        </p>

        <section className="activityHistory membershipHistory">
          <h2>История участия</h2>
          {membershipHistory.length ? (
            <ol>
              {membershipHistory.map((event) => (
                <li key={event.id}>
                  <div className="membershipHistoryEvent">
                    <strong className="membershipHistoryTitle">
                      {membershipEventLabel(event.eventType)}
                    </strong>
                    <span className="muted membershipHistoryTime">
                      Когда: <LocalDateTime value={event.occurredAt.toISOString()} />
                    </span>
                    {event.changedByParticipantId ? (
                      <small className="muted membershipHistoryAuthor">
                        Изменил: {event.changedByDisplayName ?? event.changedByParticipantId}
                      </small>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">История участия пока не зафиксирована.</p>
          )}
        </section>

        <div className="metrics">
          <article>
            <span>Активность</span>
            <strong>{activity.events30d} событий / 30 дней</strong>
            <small>
              {activity.lastActivityAt ? (
                <>
                  Последняя: <LocalDateTime value={activity.lastActivityAt.toISOString()} />
                </>
              ) : (
                "Пока нет событий"
              )}
            </small>
            <Link className="metricLink" href="/profile/activity">
              Подробнее →
            </Link>
          </article>
          <article>
            <span>Карма</span>
            <strong>Нет данных</strong>
            <Link className="metricLink" href="/profile/reputation">
              Подробнее →
            </Link>
          </article>
        </div>
      </section>
    </main>
  );
}
