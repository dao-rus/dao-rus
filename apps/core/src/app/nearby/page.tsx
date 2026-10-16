import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CoreNavigation } from "../../components/core-navigation";
import { listResidenceCommunities } from "@/lib/communities";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { residenceDirectoryHref, residenceLabel } from "@/lib/profile-about";
import { getCurrentParticipant } from "@/lib/session";
import { isParticipantsDirectoryEnabled } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Рядом" };

export default async function NearbyPage() {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const directoryEnabled = isParticipantsDirectoryEnabled();

  const [communities, { values: texts }] = await Promise.all([
    listResidenceCommunities(), readInterfaceTexts(),
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
                {directoryEnabled ? <Link href={residenceDirectoryHref(residence)}>{residenceLabel(residence)}</Link>
                  : <span>{residenceLabel(residence)}</span>}
                <span className="muted">{participantCount}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">{texts["nearby.empty"]}</p>}
      </section>
    </main>
  );
}
