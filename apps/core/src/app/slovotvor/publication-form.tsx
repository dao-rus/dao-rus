"use client";

import { useState } from "react";

const explanationPlaceholder = "Пояснение к предложению, или описание явления, которому предлагается придумать имя-слово.";

export function SlovotvorPublicationForm({ defaultSource = "" }: { defaultSource?: string }) {
  const [values, setValues] = useState({ word: "", source: defaultSource, explanation: "" });
  const hasContent = Object.values(values).some((value) => value.trim().length > 0);

  function update(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  return (
    <form className="slovotvorForm" action="/api/slovotvor" method="post">
      <div className="slovotvorWordFields">
        <input name="word" type="text" placeholder="Новое слово" aria-label="Новое слово" value={values.word} onChange={(event) => update("word", event.target.value)} />
        <input name="source" type="text" placeholder="Слово на замену" aria-label="Слово на замену" value={values.source} onChange={(event) => update("source", event.target.value)} />
      </div>
      <textarea name="explanation" placeholder={explanationPlaceholder} aria-label={explanationPlaceholder} rows={3} value={values.explanation} onChange={(event) => update("explanation", event.target.value)} />
      <button className="button primary" type="submit" disabled={!hasContent}>Выпустить слово</button>
    </form>
  );
}
