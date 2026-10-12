import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CoreNavigation } from "../../components/core-navigation";
import { LocalDateTime } from "../../components/local-date-time";
import { UserText } from "../../components/user-text";
import { countUnreadNotifications, listNotifications } from "@/lib/notifications";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Уведомления" };

type Props = { searchParams?: Promise<{ view?: string }> };

export default async function NotificationsPage({ searchParams }: Props = {}) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const unreadOnly = (await searchParams)?.view === "unread";
  const [notifications, unreadCount, { values: texts }] = await Promise.all([
    listNotifications(participant.id, unreadOnly), countUnreadNotifications(participant.id), readInterfaceTexts(),
  ]);

  return <main className="shell"><section className="card notificationsPage">
    <CoreNavigation current="notifications" texts={texts} />
    <div className="notificationsHeader">
      <div><h1>{texts["notifications.title"]}</h1>
        <p className="muted">{texts["notifications.unread_count"]}: {unreadCount}</p></div>
      {unreadCount > 0 ? <form action="/api/notifications/read" method="post">
        <input type="hidden" name="action" value="mark_all" />
        {unreadOnly ? <input type="hidden" name="view" value="unread" /> : null}
        <button className="button secondary" type="submit">{texts["notifications.mark_all"]}</button>
      </form> : null}
    </div>
    <nav className="notificationsFilter" aria-label="Фильтр уведомлений">
      <Link href="/notifications" aria-current={!unreadOnly ? "page" : undefined}>{texts["notifications.all"]}</Link>
      <Link href="/notifications?view=unread" aria-current={unreadOnly ? "page" : undefined}>{texts["notifications.unread"]}</Link>
    </nav>
    {notifications.length ? <ol className="notificationsFeed">
      {notifications.map((notification) => {
        const content = <>
          <span className="notificationTitle">
            {!notification.readAt ? <span className="notificationUnreadDot" role="img" aria-label="Непрочитанное уведомление" /> : null}
            {notification.preview ? texts["notifications.message"] : notification.text}
          </span>
          {notification.preview ? <UserText inline preview text={notification.preview} className="notificationPreview" /> : null}
          <span className="notificationDate"><LocalDateTime value={notification.createdAt.toISOString()} /></span>
        </>;
        const classes = `notificationEntry${!notification.readAt ? " notificationUnread" : ""}`;
        return <li key={notification.id}>
          {notification.actionUrl ? <form action="/api/notifications/read" method="post">
            <input type="hidden" name="action" value="open" />
            <input type="hidden" name="notification_id" value={notification.id} />
            {unreadOnly ? <input type="hidden" name="view" value="unread" /> : null}
            <button className={classes} type="submit">{content}</button>
          </form> : <div className={classes}>
            {content}
            {!notification.readAt ? <form action="/api/notifications/read" method="post" className="notificationMark">
              <input type="hidden" name="notification_id" value={notification.id} />
              {unreadOnly ? <input type="hidden" name="view" value="unread" /> : null}
              <button type="submit">{texts["notifications.mark_read"]}</button>
            </form> : null}
          </div>}
        </li>;
      })}
    </ol> : <p className="muted">{texts[unreadOnly ? "notifications.empty_unread" : "notifications.empty"]}</p>}
  </section></main>;
}
