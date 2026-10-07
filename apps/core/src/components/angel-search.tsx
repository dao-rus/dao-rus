"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { InterfaceTextValues } from "../lib/interface-texts";
import { UserText } from "./user-text";
import { SignalPreview } from "./signal-preview";

type Result = { signalId: string; typeTitle: string; label: string; description: string | null; owner: { id: string; displayName: string } | null; href: string; badge?: string | null };
function message(texts: InterfaceTextValues, code?: string) {
  if (code === "out_of_scope" || code === "suspicious_prompt") return texts[`angel.${code}`];
  if (code === "rate_limit") return texts["angel.rate_limit"];
  return texts["angel.unavailable"];
}

export function AngelSearch({ texts }: { texts: InterfaceTextValues }) {
  const [text, setText] = useState(""); const [pending, setPending] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null); const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!text.trim()) return;
    setPending(true); setError(undefined); setResults(null);
    try {
      const response = await fetch("/api/angel/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const data = await response.json() as { results?: Result[]; error?: string };
      if (!response.ok || !data.results) { setError(message(texts, data.error)); return; }
      setResults(data.results);
    } catch { setError(texts["angel.unavailable"]); } finally { setPending(false); }
  }
  return <section className="angelPanel">
    <form className="angelSearchForm" onSubmit={submit}>
      <label htmlFor="angel-search">{texts["angel.search_lead"]}</label>
      <input id="angel-search" value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} placeholder={texts["angel.search_placeholder"]} />
      <button className="button secondary" disabled={pending}>{texts["angel.search_submit"]}</button>
    </form>
    {error ? <p className="formError" role="alert">{error}</p> : null}
    {results ? <div className="exchangeCards"><h2>{texts["angel.search_results"]}</h2>
      {results.length ? results.map((result) => <SignalPreview key={result.signalId} href={result.href}
        label={result.label} description={result.description} kicker={result.typeTitle}
        author={result.owner ? result.owner.displayName : null} badge={result.badge ?? undefined} />) : <p className="muted">{texts["angel.no_results"]}</p>}
    </div> : null}
  </section>;
}
