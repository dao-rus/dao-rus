"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { InterfaceTextValues } from "../../../lib/interface-texts";

type Application = { city: string | null; occupation: string | null; age: number | null; education: string | null; familyStatus: string | null; publishAge: boolean; publicationStatus?: string; revision?: number; publishedRevision?: number | null };
type TelegramApp = { initData?: string; ready?: () => void; expand?: () => void };
type Mode = "loading" | "ready" | "browser" | "expired" | "load_error";

export function ReceptionApplicationForm({ texts, botUrl }: { texts: InterfaceTextValues; botUrl: string | null }) {
  const [mode, setMode] = useState<Mode>("loading");
  const [city, setCity] = useState("");
  const [occupation, setOccupation] = useState("");
  const [education, setEducation] = useState("");
  const [familyStatus, setFamilyStatus] = useState("");
  const [age, setAge] = useState("");
  const [publishAge, setPublishAge] = useState(false);
  const [existing, setExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [publication, setPublication] = useState<Application | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const initData = useRef("");
  const savingLock = useRef(false);
  const t = (key: keyof InterfaceTextValues) => texts[key];

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let script: HTMLScriptElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setMode("loading");
    const load = async () => {
      if (!active) return;
      if (timer) clearTimeout(timer);
      const app = (window as Window & { Telegram?: { WebApp?: TelegramApp } }).Telegram?.WebApp;
      if (!app?.initData) { setMode("browser"); return; }
      initData.current = app.initData;
      app.ready?.(); app.expand?.();
      try {
        const response = await fetch("/api/reception/application", { headers: { Authorization: `tma ${initData.current}` },
          credentials: "omit", cache: "no-store", signal: controller.signal });
        if (!active) return;
        if (response.status === 401) { setMode("expired"); return; }
        if (!response.ok) throw new Error("Application load failed");
        const body = await response.json() as { application: Application | null };
        if (!active) return;
        if (body.application) {
          setPublication(body.application);
          setCity(body.application.city ?? ""); setOccupation(body.application.occupation ?? "");
          setEducation(body.application.education ?? ""); setFamilyStatus(body.application.familyStatus ?? "");
          setAge(body.application.age === null ? "" : String(body.application.age));
          setPublishAge(body.application.publishAge); setExisting(true); setSaved(true);
        }
        setMode("ready");
      } catch { if (active) setMode("load_error"); }
    };
    if ((window as Window & { Telegram?: { WebApp?: TelegramApp } }).Telegram?.WebApp) void load();
    else {
      script = document.createElement("script"); script.src = "https://telegram.org/js/telegram-web-app.js";
      script.async = true; script.onload = () => { void load(); };
      script.onerror = () => { if (active) setMode("load_error"); };
      timer = setTimeout(() => { if (active) setMode("load_error"); }, 10_000);
      document.head.appendChild(script);
    }
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); script?.remove(); initData.current = ""; };
  }, [retry]);

  const changed = () => { setSaved(false); setError(""); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode !== "ready" || savingLock.current) return;
    savingLock.current = true; setSaving(true); setSaved(false); setError("");
    try {
      const response = await fetch("/api/reception/application", {
        method: existing ? "PUT" : "POST", credentials: "omit", cache: "no-store",
        headers: { "Content-Type": "application/json", Authorization: `tma ${initData.current}` },
        body: JSON.stringify({ city: city.trim(), occupation: occupation.trim(), education: education.trim() || null,
          familyStatus: familyStatus.trim() || null, age: age === "" ? null : Number(age), publishAge: age !== "" && publishAge }),
      });
      if (response.status === 401) { setMode("expired"); return; }
      if (!response.ok) {
        setError(response.status === 429 ? "Слишком много сохранений. Попробуйте через минуту."
          : response.status === 400 ? "Проверьте город, род занятий и возраст (целое число от 1 до 120)."
          : "Не удалось подтвердить сохранение. Попробуйте ещё раз: повтор не создаст дубль.");
        return;
      }
      const body = await response.json() as { application: Application };
      setPublication(body.application); setExisting(true); setSaved(true);
    } catch { setError("Не удалось подтвердить сохранение. Проверьте соединение и попробуйте ещё раз: повтор не создаст дубль."); }
    finally { savingLock.current = false; setSaving(false); }
  }

  const botLink = botUrl && <a className="button secondary" href={botUrl}>{t("reception.apply.open_bot")}</a>;
  if (mode === "loading") return <p role="status">Загружаем анкету…</p>;
  if (mode === "browser") return <><p>Откройте анкету через кнопку «Заполнить анкету» в боте Приёмной.</p>{botLink}</>;
  if (mode === "load_error") return <><p role="alert">Не удалось загрузить анкету. Проверьте соединение и повторите попытку.</p>
    <button className="button secondary" onClick={() => setRetry(value => value + 1)}>Повторить загрузку</button></>;
  if (mode === "expired") return <><p role="alert">Вход через Telegram истёк или не подтверждён. Закройте Mini App и откройте анкету заново через бота Приёмной.</p>{botLink}</>;
  return <form className="receptionForm" onSubmit={submit}>
    <fieldset disabled={saving}>
      <label htmlFor="reception-city">{t("reception.apply.city")}</label>
      <input id="reception-city" name="city" required maxLength={200} autoComplete="address-level2" value={city}
        onChange={event => { setCity(event.target.value); changed(); }} />
      <label htmlFor="reception-occupation">{t("reception.apply.occupation")}</label>
      <input id="reception-occupation" name="occupation" required maxLength={1000} value={occupation}
        onChange={event => { setOccupation(event.target.value); changed(); }} />
      <label htmlFor="reception-education">Образование (необязательно)</label>
      <input id="reception-education" name="education" maxLength={500} value={education}
        onChange={event => { setEducation(event.target.value); changed(); }} />
      <label htmlFor="reception-family-status">Семейное положение (необязательно)</label>
      <input id="reception-family-status" name="familyStatus" maxLength={120} value={familyStatus}
        onChange={event => { setFamilyStatus(event.target.value); changed(); }} />
      <label htmlFor="reception-age">{t("reception.apply.age")}</label>
      <input id="reception-age" name="age" type="number" min={1} max={120} step={1} inputMode="numeric" value={age}
        onChange={event => { setAge(event.target.value); if (!event.target.value) setPublishAge(false); changed(); }} />
      <label className="receptionConsent"><input name="publishAge" type="checkbox" checked={publishAge} disabled={!age}
        onChange={event => { setPublishAge(event.target.checked); changed(); }} />{t("reception.apply.consent")}</label>
    </fieldset>
    <p className="muted">{t("reception.apply.privacy")}</p>
    <section className="receptionPreview" aria-labelledby="reception-preview-title">
      <h2 id="reception-preview-title">{t("reception.apply.preview")}</h2>
      <dl><dt>{t("reception.apply.city")}</dt><dd>{city.trim() || "—"}</dd>
        <dt>{t("reception.apply.occupation")}</dt><dd>{occupation.trim() || "—"}</dd>
        <dt>Образование</dt><dd>{education.trim() || "—"}</dd>
        <dt>Семейное положение</dt><dd>{familyStatus.trim() || "—"}</dd>
        {publishAge && age && <><dt>{t("reception.apply.preview_age")}</dt><dd>{age}</dd></>}
      </dl>
    </section>
    {error && <p className="formError" role="alert">{error}</p>}
    {saved && <p className="formNotice" role="status">{t(publication?.publicationStatus === "needs_review" ? "reception.apply.review"
      : publication?.publicationStatus === "delivered" && publication.revision === publication.publishedRevision ? "reception.apply.delivered"
      : publication?.publishedRevision ? "reception.apply.edit_pending" : "reception.apply.saved")}</p>}
    <button className="button primary" disabled={saving} type="submit">{saving ? "Сохраняем…" : t(existing ? "reception.apply.update" : "reception.apply.submit")}</button>
  </form>;
}
