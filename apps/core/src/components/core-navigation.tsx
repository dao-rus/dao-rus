import Link from "next/link";
import { readInterfaceTexts, type InterfaceTextValues } from "../lib/interface-texts";
import { countUnreadNotifications } from "../lib/notifications";
import { getCurrentParticipant } from "../lib/session";
import { PrivateMessagesLink } from "./private-messages-link";

type CoreSection = "home" | "veche" | "exchange" | "participants" | "nearby" | "profile" | "code" | "notifications";

export async function CoreNavigation({ current, texts: providedTexts }: {
  current?: CoreSection;
  texts?: InterfaceTextValues;
}) {
  const texts = providedTexts ?? (await readInterfaceTexts()).values;
  const participant = await getCurrentParticipant();
  const unreadCount = participant ? await countUnreadNotifications(participant.id) : 0;
  const links: { section: CoreSection; href: string; label: string }[] = [
    { section: "home", href: "/", label: texts["nav.home"] },
    { section: "veche", href: "/veche", label: texts["nav.veche"] },
    { section: "exchange", href: "/exchange", label: texts["exchange.title"] },
    { section: "participants", href: "/participants", label: texts["participants.title"] },
    { section: "nearby", href: "/nearby", label: texts["nearby.title"] },
    { section: "profile", href: "/profile", label: texts["home.profile_button"] },
    { section: "code", href: "/code", label: texts["nav.code"] },
  ];

  return (
    <nav className="coreNavigation" aria-label="Основные разделы">
      {links.map(({ section, href, label }) => (
        <Link key={section} className="button secondary" href={href}
          aria-current={current === section ? "page" : undefined}>{label}</Link>
      ))}
      {participant ? <PrivateMessagesLink label={texts["nav.private_messages"]}
        unreadCount={unreadCount} current={current === "notifications"} /> : null}
    </nav>
  );
}
