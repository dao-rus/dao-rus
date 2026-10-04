import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CoreNavigation } from "../../components/core-navigation";
import { LocalDateTime } from "../../components/local-date-time";
import { listNotifications } from "@/lib/notifications";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Уведомления" };

export default async function NotificationsPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const notifications = await listNotifications(participant.id);

  return (
    <main className="shell">
      <section className="card profile">
        <CoreNavigation current="notifications" />
        <div className="profileHeader">
          <div><div className="eyebrow">DAO Core</div><h1>Уведомления</h1></div>
          <Link className="button secondary" href="/profile">К профилю</Link>
        </div>
        {notifications.length ? (
          <section className="activityHistory">
            <ol>
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <div>
                    <p>{notification.text}</p>
                    <span className="muted">Создано: <LocalDateTime value={notification.createdAt.toISOString()} /></span>
                    <span>{notification.readAt ? "Прочитано" : "Не прочитано"}</span>
                    {notification.actionUrl ? <Link href={notification.actionUrl}>Открыть ссылку →</Link> : null}
                    {!notification.readAt ? (
                      <form action="/api/notifications/read" method="post">
                        <input type="hidden" name="notification_id" value={notification.id} />
                        <button className="button secondary" type="submit">Отметить прочитанным</button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : <p className="muted">Уведомлений пока нет.</p>}
      </section>
    </main>
  );
}
