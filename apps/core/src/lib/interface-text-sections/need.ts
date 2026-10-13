// Раздел «Мне нужно» реестра надписей интерфейса.
export const needTexts = [
  { section: "Мне нужно", key: "need.title", label: "Заголовок", defaultValue: "Что вам нужно?", multiline: false },
  { section: "Мне нужно", key: "need.lead", label: "Вводный текст", defaultValue: "Опишите потребность своими словами. Запись появится в вашем профиле.", multiline: true },
] as const;
