"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { InterfaceTextValues } from "../lib/interface-texts";

type Result = { signalId: string; typeTitle: string; label: string; description: string | null; owner: { id: string; displayName: string } | null; href: string };
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
    <form className="actions" onSubmit={submit}>
      <label className="srOnly" htmlFor="angel-search">{texts["angel.search_placeholder"]}</label>
      <input id="angel-search" value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} placeholder={texts["angel.search_placeholder"]} />
      <button className="button secondary" disabled={pending}>{texts["angel.search_submit"]}</button>
    </form>
    {error ? <p className="formError" role="alert">{error}</p> : null}
    {results ? <div className="exchangeCards"><h2>{texts["angel.search_results"]}</h2>
      {results.length ? results.map((result) => <article className="exchangeCard" key={result.signalId}>
        <p className="muted">{result.typeTitle}</p><strong><Link href={result.href}>{result.label}</Link></strong>
        {result.description ? <p className="profileBio">{result.description}</p> : null}
        {result.owner ? <Link href={`/profile/${result.owner.id}`}>{result.owner.displayName}</Link> : null}
      </article>) : <p className="muted">{texts["angel.no_results"]}</p>}
    </div> : null}
  </section>;
}
