// Раздел «Сообщества» реестра надписей интерфейса.
export const communitiesTexts = [
  { section: "Сообщества", key: "community.residence_title", label: "Префикс заголовка места", defaultValue: "Сообщество", multiline: false },
  { section: "Сообщества", key: "community.interest_title", label: "Префикс заголовка интереса", defaultValue: "Сообщество", multiline: false },
  { section: "Сообщества", key: "community.members_title", label: "Заголовок списка участников", defaultValue: "Участники", multiline: false },
  { section: "Сообщества", key: "community.feed_title", label: "Заголовок ленты", defaultValue: "Объявления сообщества", multiline: false },
  { section: "Сообщества", key: "community.feed_empty", label: "Пустая лента", defaultValue: "Объявлений пока нет.", multiline: false },
] as const;
