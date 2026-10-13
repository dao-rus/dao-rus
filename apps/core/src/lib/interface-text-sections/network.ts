// Раздел «Сеть» реестра надписей интерфейса.
export const networkTexts = [
  { section: "Сеть", key: "participants.title", label: "Заголовок", defaultValue: "Сеть", multiline: false },
  { section: "Сеть", key: "participants.sort_label", label: "Подпись сортировки", defaultValue: "Сортировка:", multiline: false },
  { section: "Сеть", key: "participants.sort_name", label: "Сортировка по имени", defaultValue: "Имя", multiline: false },
  { section: "Сеть", key: "participants.sort_verification", label: "Сортировка по верификации", defaultValue: "Топ-верификация", multiline: false },
  { section: "Сеть", key: "participants.sort_reputation", label: "Сортировка по репутации", defaultValue: "Топ-репутация", multiline: false },
  { section: "Сеть", key: "participants.sort_joined", label: "Сортировка по дате вступления", defaultValue: "Дата вступления", multiline: false },
  { section: "Сеть", key: "participants.sort_joined_oldest", label: "Дата вступления: сначала старые", defaultValue: "Сначала старые", multiline: false },
  { section: "Сеть", key: "participants.sort_joined_newest", label: "Дата вступления: сначала новые", defaultValue: "Сначала новые", multiline: false },
  { section: "Сеть", key: "participants.sort_core", label: "Показать вошедших в Ядро", defaultValue: "Ядро", multiline: false },
] as const;
