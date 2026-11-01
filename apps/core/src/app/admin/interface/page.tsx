import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { AdminCrumbs } from "../../../components/admin-crumbs";
import { CoreNavigation } from "../../../components/core-navigation";
import { interfaceTextFields, readInterfaceTexts } from "@/lib/interface-texts";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Тексты интерфейса" };

type InterfacePageProps = {
  searchParams: Promise<{ interface_update?: string }>;
};

const updateMessages: Record<string, string> = {
  updated: "Тексты сохранены.",
  unchanged: "Изменений нет.",
  invalid: "Не удалось прочитать все поля формы. Обновите страницу и попробуйте снова.",
};

const sections = [...new Set(interfaceTextFields.map((field) => field.section))];
const sectionAnchor = (index: number) => `interface-section-${index + 1}`;

export default async function InterfacePage({ searchParams }: InterfacePageProps) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");

  const [{ values, overrides }, params] = await Promise.all([
    readInterfaceTexts(),
    searchParams,
  ]);
  const message = params.interface_update
    ? updateMessages[params.interface_update]
    : null;

  return (
    <main className="shell">
      <section className="card profile">
        <CoreNavigation texts={values} />
        <div className="profileHeader">
          <div>
            <AdminCrumbs href="/admin/interface" />
            <h1>Тексты интерфейса</h1>
            <p className="muted">Пользовательские тексты разделов DAO Core. Галочка вернёт отдельное поле к значению по умолчанию.</p>
          </div>
        </div>

        {message ? (
          <p className={params.interface_update === "invalid" ? "formError" : "formNotice"}>
            {message}
          </p>
        ) : null}

        <nav aria-label="Разделы текстов интерфейса" style={{ marginBottom: "1.5rem" }}>
          <p className="muted">Перейти к разделу:</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1rem" }}>
            {sections.map((section, index) => (
              <a key={section} href={`#${sectionAnchor(index)}`}>{section}</a>
            ))}
          </div>
        </nav>

        <form className="interfaceForm" action="/api/admin/interface" method="post">
          {sections.map((section, index) => (
            <section className="interfaceSection" id={sectionAnchor(index)} key={section} style={{ scrollMarginTop: "1rem" }}>
              <h2>{section}</h2>
              {interfaceTextFields.filter((field) => field.section === section).map((field) => (
                <div className="interfaceField" key={field.key}>
                  <div className="interfaceFieldContext">
                    {field.pageHref ? (
                      <Link href={field.pageHref}>{field.pageLabel} <span aria-hidden="true">↗</span></Link>
                    ) : <span>{field.pageLabel}</span>}
                  </div>
                  <label htmlFor={field.key}>{field.label}</label>
                  {field.multiline ? (
                    <textarea id={field.key} name={field.key} defaultValue={values[field.key]} />
                  ) : (
                    <input id={field.key} name={field.key} defaultValue={values[field.key]} />
                  )}
                  <small className="muted">По умолчанию: {field.defaultValue}</small>
                  <label className="interfaceReset">
                    <input type="checkbox" name={`reset.${field.key}`} />
                    Вернуть по умолчанию
                  </label>
                  {overrides[field.key] !== null ? <small className="muted">Сейчас изменено</small> : null}
                </div>
              ))}
            </section>
          ))}
          <button className="button primary" type="submit">Сохранить тексты</button>
        </form>
      </section>
    </main>
  );
}
