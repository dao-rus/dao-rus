// Раздел «Диалоги» реестра надписей интерфейса.
export const relayTexts = [
  { section: "Диалоги", key: "relay.notify_response", label: "Уведомление автору об отклике", defaultValue: "На вашу запись откликнулись.", multiline: false },
  { section: "Диалоги", key: "relay.notify_action", label: "Уведомление об отклике: кнопка", defaultValue: "Открыть диалог", multiline: false },
  { section: "Диалоги", key: "relay.list_title", label: "Заголовок списка", defaultValue: "Диалоги", multiline: false },
  { section: "Диалоги", key: "relay.archive_title", label: "Заголовок архива", defaultValue: "Архив диалогов", multiline: false, pageLabel: "Архив диалогов", pageHref: "/relay?archive=1" },
  { section: "Диалоги", key: "relay.dialog_title", label: "Заголовок диалога", defaultValue: "Диалог", multiline: false, pageLabel: "Диалог", pageHref: undefined },
  { section: "Диалоги", key: "relay.list_empty", label: "Пустой список диалогов", defaultValue: "Активных диалогов пока нет.", multiline: false },
  { section: "Диалоги", key: "relay.archive_empty", label: "Пустой архив", defaultValue: "Архив пуст.", multiline: false, pageLabel: "Архив диалогов", pageHref: "/relay?archive=1" },
  { section: "Диалоги", key: "relay.messages_empty", label: "Пустая переписка", defaultValue: "Сообщений пока нет.", multiline: false, pageLabel: "Диалог", pageHref: undefined },
] as const;
