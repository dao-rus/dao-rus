import Link from "next/link";

export function PrivateMessagesLink({ label, unreadCount, current = false }: {
  label: string;
  unreadCount: number;
  current?: boolean;
}) {
  const hasUnread = unreadCount > 0;
  return (
    <Link href="/notifications"
      className={`button secondary privateMessagesLink${hasUnread ? " hasUnread" : ""}`}
      aria-current={current ? "page" : undefined}
      data-has-unread={hasUnread}>
      <span className="privateMessagesEnvelope" aria-hidden="true">✉</span>
      <span>{label}</span>
    </Link>
  );
}
