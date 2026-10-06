import Link from "next/link";
import type { Signal, SignalType } from "../lib/signals";
import type { InterfaceTextValues } from "../lib/interface-texts";
import { groupProfileSignals, signalHref, signalTypePresentation } from "../lib/signal-presentation";
import { SignalPreview } from "./signal-preview";

export function ProfileSignals({ signals, types, texts, owner = false }: {
  signals: Signal[]; types: SignalType[]; texts: InterfaceTextValues; owner?: boolean;
}) {
  return <div className="aboutBlock">
    {owner || signals.length ? <h3>{texts["signal.profile_title"]}</h3> : null}
    {groupProfileSignals(signals, types).map(({ type, signals: entries }) => <section className="signalEntryCard" key={type.key} id={`signal-${type.key}`}>
      <h4>{signalTypePresentation(type, texts).name}</h4>
      <ul className="profileItems signalItems">{entries.map((signal) => <SignalPreview as="li" key={signal.id}
        href={signalHref(signal.id)} label={signal.label} description={signal.description}
        meta={owner ? texts[`signal.visibility_${signal.visibility}`] : undefined}>
        {owner ? <div className="actions">
          <Link className="button secondary compact" href={`/exchange/new?signal=${signal.id}`}>
            {texts[signal.legacyBody ? "signal.refine" : "signal.edit"]}</Link>
          <form action="/api/profile/about" method="post">
            <input type="hidden" name="action" value="archive_signal" />
            <input type="hidden" name="signal_id" value={signal.id} />
            <button className="button secondary compact" type="submit">{texts["signal.archive"]}</button>
          </form></div> : null}
      </SignalPreview>)}</ul>
    </section>)}
    {owner ? <Link className="button secondary" href="/exchange/new">{texts["signal.create"]}</Link> : null}
  </div>;
}
