import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CoreNavigation } from "../../../components/core-navigation";
import { readInterfaceTexts } from "../../../lib/interface-texts";
import { getCurrentParticipant } from "../../../lib/session";
import { getSignal, listSignalTypes } from "../../../lib/signals";
import { signalTypePresentation } from "../../../lib/signal-presentation";

export const dynamic = "force-dynamic";

// B1 is an internal Core card. Metadata never reads Signal content or identity,
// including for absent/hidden records; public propagation belongs to Share.
export async function generateMetadata(): Promise<Metadata> {
  const { values: texts } = await readInterfaceTexts();
  return { title: texts["signal.card_title"], robots: { index: false, follow: false } };
}

export default async function SignalPage({ params }: { params: Promise<{ signalId: string }> }) {
  const viewer = await getCurrentParticipant();
  if (!viewer) redirect("/");
  const { signalId } = await params;
  const signal = await getSignal(viewer.id, signalId);
  if (!signal) notFound();
  const [types, { values: texts }] = await Promise.all([listSignalTypes(), readInterfaceTexts()]);
  const type = types.find((entry) => entry.key === signal.typeKey);
  if (!type) notFound();
  const presentation = signalTypePresentation(type, texts);
  const author = signal.visibility === "network_blind" ? null : signal.author;

  return <main className="shell"><section className="card profile">
    <CoreNavigation current="exchange" texts={texts} />
    <div className="eyebrow">{presentation.name}</div>
    <h1 className="profileBio">{signal.label}</h1>
    {signal.description ? <p className="profileBio">{signal.description}</p> : null}
    {author ? <p><Link href={`/profile/${author.id}`}>{author.name}</Link></p> : null}
    {signal.mine ? <p className="muted">
      {texts[`signal.visibility_${signal.visibility}`]} · {texts[`signal.status_${signal.status}`]}
    </p> : null}
    <div className="actions">
      {signal.mine && signal.status === "active" ? <>
        <Link className="button secondary" href={`/exchange/new?signal=${signal.id}`}>
          {texts[signal.legacyBody ? "signal.refine" : "signal.edit"]}
        </Link>
        <form action="/api/profile/about" method="post">
          <input type="hidden" name="action" value="archive_signal" />
          <input type="hidden" name="signal_id" value={signal.id} />
          <button className="button secondary" type="submit">{texts["signal.archive"]}</button>
        </form>
      </> : null}
      {!signal.mine && signal.status === "active" && signal.visibility === "network_blind"
        && (signal.typeKey === "need" || signal.typeKey === "have") ?
        <form action="/api/relay" method="post">
          <input type="hidden" name="action" value="respond" />
          <input type="hidden" name="signal_id" value={signal.id} />
          <button className="button primary" type="submit">{texts["signal.respond"]}</button>
        </form> : null}
      {author ? <Link className="button secondary" href={`/profile/${author.id}`}>{texts["signal.owner_profile"]}</Link> : null}
      <Link className="button secondary" href="/exchange">{texts["signal.back_exchange"]}</Link>
    </div>
  </section></main>;
}
