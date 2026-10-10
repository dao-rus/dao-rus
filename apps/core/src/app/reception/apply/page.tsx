import type { Metadata } from "next";
import { readInterfaceTexts } from "../../../lib/interface-texts";
import { telegramReceptionConfig } from "../../../lib/config";
import { ReceptionApplicationForm } from "./reception-application-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Анкета — Приёмная ДАО Русь", robots: { index: false, follow: false } };

export default async function ReceptionApplyPage() {
  const { values } = await readInterfaceTexts();
  const { botUsername } = telegramReceptionConfig();
  return <main className="shell receptionApply"><section className="card">
    <h1>{values["reception.apply.title"]}</h1>
    <p className="lead">{values["reception.apply.lead"]}</p>
    <ReceptionApplicationForm texts={values} botUrl={botUsername ? `https://t.me/${botUsername}` : null} />
  </section></main>;
}
