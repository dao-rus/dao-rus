import type { InterfaceTextValues } from "../lib/interface-texts";
import Link from "next/link";
import { findAdminSection } from "../lib/admin-sections";

type Crumb = { label: string; href?: string };

// The same path line on every management page: Управление › Группа › Раздел [› вложенная страница].
// Pages deeper than a section (an award, one of its batches) pass the extra steps as `trail`.
export function AdminCrumbs({ href, trail = [], texts }: { href: string; trail?: Crumb[]; texts?: InterfaceTextValues }) {
  const found = findAdminSection(href);
  const steps: Crumb[] = [
    { label: "Управление", href: "/admin" },
    ...(found ? [{ label: found.group.title }, { label: texts && found.section.titleKey ? texts[found.section.titleKey] : found.section.title, href: trail.length ? found.section.href : undefined }] : []),
    ...trail,
  ];
  return (
    <nav className="adminCrumbs" aria-label="Путь по управлению">
      <ol>
        {steps.map((step, index) => {
          const last = index === steps.length - 1;
          return <li key={`${index}:${step.label}`}>
            {step.href && !last ? <Link href={step.href}>{step.label}</Link>
              : <span aria-current={last ? "page" : undefined}>{step.label}</span>}
          </li>;
        })}
      </ol>
    </nav>
  );
}
