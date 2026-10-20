// Раздел «Рядом» реестра надписей интерфейса.
export const nearbyTexts = [
  { section: "Рядом", key: "nearby.title", label: "Заголовок и кнопка раздела", defaultValue: "Рядом", multiline: false },
  { section: "Рядом", key: "nearby.lead", label: "Подзаголовок", defaultValue: "Участники ДАО по месту жительства.", multiline: false },
  { section: "Рядом", key: "nearby.empty", label: "Пустой список", defaultValue: "Сообществ по месту жительства пока нет.", multiline: false },
  { section: "Рядом", key: "nearby.unspecified", label: "Сообщество без места жительства", defaultValue: "Не указавшие", multiline: false },
  { section: "Рядом", key: "nearby.unspecified_empty", label: "Пустое сообщество без места жительства", defaultValue: "Все участники указали место жительства.", multiline: false },
] as const;
