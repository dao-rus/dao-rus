"use client";

import { useState } from "react";

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
        <input name="source" type="text" placeholder="Какое слово заменить?" aria-label="Какое слово заменить?" value={values.source} onChange={(event) => update("source", event.target.value)} />
      </div>
      <textarea name="explanation" placeholder="Пояснение или описание явления" aria-label="Пояснение или описание явления" rows={3} value={values.explanation} onChange={(event) => update("explanation", event.target.value)} />
      <p className="slovotvorFormHint">Можно заполнить любое одно поле или несколько.</p>
      <button className="button primary" type="submit" disabled={!hasContent}>Выпустить слово</button>
    </form>
  );
}
