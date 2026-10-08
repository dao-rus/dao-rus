// One list of everything the management area contains. The "Управление" page, the breadcrumb on every
// admin page and the access rule all read from here, so moving a function to another group, or to
// other hands later, is a change in this file and not a hunt through pages.
// Groups answer "what is being managed", never "who manages it".

/** Who may open a section. Transferring a function means changing this one value. */
export type AdminAccess = "admin" | "award.establish";

export type AdminSection = { href: string; title: string; hint: string; access: AdminAccess };
export type AdminGroup = { key: string; title: string; sections: AdminSection[] };

export const adminGroups: AdminGroup[] = [
  { key: "people", title: "Люди", sections: [
    { href: "/admin/participants", title: "Реестр ДАО", hint: "Участники, их статусы и присутствие в Telegram", access: "admin" },
    { href: "/admin/verification-roots", title: "Начальное ядро доверия", hint: "Кто стоит у истока подтверждения личности", access: "admin" },
    { href: "/admin/guardian/arrivals", title: "История прибытия", hint: "Кто и когда вступил в форум", access: "admin" },
    { href: "/admin/guardian/departures", title: "История убытия", hint: "Кто и когда вышел из форума", access: "admin" },
    { href: "/admin/reputation", title: "История репутации", hint: "Отметки о хорошем опыте и о проблемах", access: "admin" },
  ] },
  { key: "guardian", title: "Хранитель", sections: [
    { href: "/admin/guardian", title: "Рассылки", hint: "Состояние участников и сообщение от Хранителя", access: "admin" },
    { href: "/admin/guardian/forum", title: "Форум и маршруты", hint: "Что Хранитель делает между Ядром и форумом", access: "admin" },
  ] },
  { key: "treasury", title: "Казна", sections: [
    { href: "/admin/rewards", title: "Тарифы DARUS", hint: "Сколько начисляется за подтверждение личности", access: "admin" },
    { href: "/admin/awards", title: "Награды", hint: "Учреждение наград и их выпуски", access: "award.establish" },
  ] },
  { key: "words", title: "Слова и справочники", sections: [
    { href: "/admin/interface", title: "Тексты интерфейса", hint: "Все подписи и сообщения Ядра", access: "admin" },
    { href: "/admin/closer", title: "Цели «Ближе»", hint: "По каким целям ищутся совпадения", access: "admin" },
  ] },
];

export function findAdminSection(href: string): { group: AdminGroup; section: AdminSection } | null {
  for (const group of adminGroups) {
    const section = group.sections.find((item) => item.href === href);
    if (section) return { group, section };
  }
  return null;
}
