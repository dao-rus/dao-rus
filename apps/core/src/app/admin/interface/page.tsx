import Link from "next/link";
import { redirect } from "next/navigation";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { interfaceTextFields, readInterfaceTexts } from "@/lib/interface-texts";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";

type InterfacePageProps = {
  searchParams: Promise<{ interface_update?: string }>;
};

const updateMessages: Record<string, string> = {
  updated: "Тексты сохранены.",
  unchanged: "Изменений нет.",
  invalid: "Проверьте заполнение полей. Текст не должен быть пустым или длиннее 1000 символов.",
};

const sections = [...new Set(interfaceTextFields.map((field) => field.section))];

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
        <div className="profileHeader">
          <div>
            <div className="eyebrow">Ядро</div>
            <h1>Тексты интерфейса</h1>
            <p className="muted">Пользовательские тексты разделов DAO Core. Галочка вернёт отдельное поле к значению по умолчанию.</p>
          </div>
          <Link className="button secondary" href="/admin">К управлению</Link>
        </div>

        {message ? (
          <p className={params.interface_update === "invalid" ? "formError" : "formNotice"}>
            {message}
          </p>
        ) : null}

        <form className="interfaceForm" action="/api/admin/interface" method="post">
          {sections.map((section) => (
            <section className="interfaceSection" key={section}>
              <h2>{section}</h2>
              {interfaceTextFields.filter((field) => field.section === section).map((field) => (
                <div className="interfaceField" key={field.key}>
                  <label htmlFor={field.key}>{field.label}</label>
                  {field.multiline ? (
                    <textarea id={field.key} name={field.key} defaultValue={values[field.key]} maxLength={1000} />
                  ) : (
                    <input id={field.key} name={field.key} defaultValue={values[field.key]} maxLength={1000} />
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
