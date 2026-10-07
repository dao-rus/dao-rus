import Link from "next/link";
import { readInterfaceTexts, type InterfaceTextValues } from "../lib/interface-texts";
import { countUnreadNotifications } from "../lib/notifications";
import { getCurrentParticipant } from "../lib/session";
import { PrivateMessagesLink } from "./private-messages-link";
import { DarusRewardCelebration } from "./darus-reward-celebration";
import { readPendingReward } from "../lib/reward-announcements";

type CoreSection = "home" | "veche" | "exchange" | "participants" | "nearby" | "profile" | "code" | "notifications";

export async function CoreNavigation({ current, texts: providedTexts }: {
  current?: CoreSection;
  texts?: InterfaceTextValues;
}) {
  const texts = providedTexts ?? (await readInterfaceTexts()).values;
  const participant = await getCurrentParticipant();
  const unreadCount = participant ? await countUnreadNotifications(participant.id) : 0;
  // A reward that arrived while the participant was away falls from the top of whatever page they open next.
  const reward = participant ? await readPendingReward(participant.id).catch(() => null) : null;
  const links: { section: CoreSection; href: string; label: string }[] = [
    { section: "home", href: "/", label: texts["nav.home"] },
    { section: "veche", href: "/veche", label: texts["nav.veche"] },
    { section: "participants", href: "/participants", label: texts["participants.title"] },
    { section: "exchange", href: "/exchange", label: texts["exchange.title"] },
    { section: "nearby", href: "/nearby", label: texts["nearby.title"] },
  ];

  return (
    <nav className="coreNavigation" aria-label="Основные разделы">
      {links.map(({ section, href, label }) => (
        <Link key={section} className="button secondary" href={href}
          aria-current={current === section ? "page" : undefined}>{label}</Link>
      ))}
      {participant ? <PrivateMessagesLink label={texts["nav.private_messages"]}
        unreadCount={unreadCount} current={current === "notifications"} /> : null}
      <Link className="button secondary" href="/profile"
        aria-current={current === "profile" ? "page" : undefined}>{texts["home.profile_button"]}</Link>
      {reward ? <DarusRewardCelebration key={reward.id} entryId={reward.id} amount={reward.amount}
        caption={texts["reward.record_responded"]} announce /> : null}
    </nav>
  );
}
