import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CoreNavigation } from "../../../components/core-navigation";
import { SignalForm } from "../../../components/signal-form";
import { readInterfaceTexts } from "../../../lib/interface-texts";
import { getCurrentParticipant } from "../../../lib/session";
import { listParticipantSignals, listSignalTypes } from "../../../lib/signals";
import { selectSignalType } from "../../../lib/signal-presentation";
import { getCloserCity, listCloserGoals, listOwnCloserKeys } from "../../../lib/closer";

export const dynamic = "force-dynamic";
export default async function NewSignalPage({ searchParams }: {
  searchParams: Promise<{ type?: string; signal?: string; error?: string }>;
}) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  const params = await searchParams;
  const [catalog, { values: texts }, goals, city, closerKeys] = await Promise.all([listSignalTypes(), readInterfaceTexts(),
    listCloserGoals(), getCloserCity(participant.id), listOwnCloserKeys(participant.id)]);
  const signal = params.signal ? (await listParticipantSignals(participant.id, participant.id))
    .find((entry) => entry.id === params.signal) : undefined;
  if (params.signal && !signal) notFound();
  const types = signal ? catalog : catalog.filter((entry) => entry.enabled);
  const selected = signal ? catalog.find((entry) => entry.key === signal.typeKey) : selectSignalType(types, params.type);
  if (signal && !selected) notFound();
  return <main className="shell"><section className="card profile">
    <CoreNavigation current="exchange" texts={texts} />
    <h1>{texts[signal ? "signal.edit_title" : "signal.new_title"]}</h1>
    {params.error ? <p className="formError" role="alert">{texts["signal.invalid"]}</p> : null}
    {selected ? <SignalForm types={types} initialType={selected.key} signal={signal} texts={texts}
      closer={{ goals, city, keys: signal ? closerKeys.get(signal.id) : undefined }} />
      : <p className="muted">{texts["signal.empty_types"]}</p>}
    <Link className="button secondary" href="/profile">{texts["signal.profile_link"]}</Link>
  </section></main>;
}
