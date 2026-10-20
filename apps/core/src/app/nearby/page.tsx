import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CoreNavigation } from "../../components/core-navigation";
import { communityHref, listResidenceCommunities } from "@/lib/communities";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { residenceLabel } from "@/lib/profile-about";
import { getCurrentParticipant } from "@/lib/session";
import { listParticipantsDirectory } from "@/lib/participants-directory";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Рядом" };

export default async function NearbyPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");

  const [communities, { values: texts }, unspecified] = await Promise.all([
    listResidenceCommunities(), readInterfaceTexts(),
    listParticipantsDirectory("", { withoutResidence: true, viewerParticipantId: participant.id }),
  ]);

  return (
    <main className="shell">
      <section className="card nearbyPage">
        <CoreNavigation current="nearby" texts={texts} />
        <h1>{texts["nearby.title"]}</h1>
        <p className="lead">{texts["nearby.lead"]}</p>
        {communities.length ? (
          <ul className="nearbyCommunities">
            {communities.map(({ residence, participantCount }) => (
              <li key={JSON.stringify([residence.country, residence.type, residence.name])}>
                <Link href={communityHref({ type: "residence", residence })}>{residenceLabel(residence)}</Link>
                <span className="muted">{participantCount}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">{texts["nearby.empty"]}</p>}
        <ul className="nearbyCommunities">
          <li>
            <Link href="/participants?without_residence=1">{texts["nearby.unspecified"]}</Link>
            <span className="muted">{unspecified.length}</span>
          </li>
        </ul>
      </section>
    </main>
  );
}
