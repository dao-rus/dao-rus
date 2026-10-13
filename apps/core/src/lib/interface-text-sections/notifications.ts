// Раздел «Уведомления» реестра надписей интерфейса.
export const notificationsTexts = [
  { section: "Уведомления", key: "notifications.title", label: "Заголовок ленты", defaultValue: "Уведомления", multiline: false },
  { section: "Уведомления", key: "notifications.unread_count", label: "Счётчик непрочитанных", defaultValue: "Непрочитанных", multiline: false },
  { section: "Уведомления", key: "notifications.all", label: "Все уведомления", defaultValue: "Все", multiline: false },
  { section: "Уведомления", key: "notifications.unread", label: "Непрочитанные уведомления", defaultValue: "Непрочитанные", multiline: false },
  { section: "Уведомления", key: "notifications.message", label: "Описание сообщения", defaultValue: "Сообщение от Хранителя", multiline: false },
  { section: "Уведомления", key: "notifications.mark_all", label: "Массовая отметка прочтения", defaultValue: "Отметить все прочитанными", multiline: false },
  { section: "Уведомления", key: "notifications.mark_read", label: "Отметка прочтения", defaultValue: "Отметить прочитанным", multiline: false },
  { section: "Уведомления", key: "notifications.empty", label: "Пустая лента", defaultValue: "Уведомлений пока нет.", multiline: false },
  { section: "Уведомления", key: "notifications.empty_unread", label: "Нет непрочитанных", defaultValue: "Непрочитанных уведомлений нет.", multiline: false },
] as const;
