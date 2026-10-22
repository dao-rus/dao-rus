// Раздел «Главная» реестра надписей интерфейса.
export const homeTexts = [
  { section: "Главная", key: "home.eyebrow", label: "Надпись над заголовком", defaultValue: "Ядро", multiline: false },
  { section: "Главная", key: "home.title", label: "Заголовок", defaultValue: "ДАО Русь", multiline: false },
  {
    section: "Главная",
    key: "home.lead",
    label: "Основной текст",
    defaultValue: "Пространство, где мы вместе строим Русь.",
    multiline: true,
  },
  { section: "Главная", key: "home.login_button", label: "Кнопка входа", defaultValue: "Войти через Telegram", multiline: false },
  { section: "Главная", key: "home.profile_button", label: "Кнопка профиля", defaultValue: "Профиль", multiline: false },
  { section: "Главная", key: "home.code_link", label: "Ссылка на Кодекс", defaultValue: "Открыть Кодекс →", multiline: false },
  { section: "Главная", key: "home.code_unread", label: "Новые комментарии к Кодексу", defaultValue: "Новые комментарии к Кодексу", multiline: false },
  { section: "Главная", key: "home.code_title", label: "Заголовок Кодекса", defaultValue: "Кодекс руси", multiline: false },
  { section: "Главная", key: "onboarding.residence", label: "Первый город", defaultValue: "Укажите город, чтобы найти сообщество рядом", multiline: false },
  { section: "Главная", key: "onboarding.interest", label: "Первый интерес", defaultValue: "Добавьте интерес, чтобы найти единомышленников", multiline: false },
  { section: "Главная", key: "onboarding.need", label: "Первая потребность", defaultValue: "Расскажите, что вам нужно. Награда придёт, когда запись кому-то отзовётся", multiline: false },
  { section: "Главная", key: "onboarding.have", label: "Первое предложение", defaultValue: "Расскажите, что у вас есть. Награда придёт, когда запись кому-то отзовётся", multiline: false },
] as const;
