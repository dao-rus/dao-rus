import { signalPresentationDefaults, signalGroupDefaults } from "./signal-presentation";

const interfaceTextFieldDefinitions = [
  {"section":"Вече","key":"veche.collecting","label":"Сбор подписей","defaultValue":"Сбор подписей","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.not_called","label":"Не созван","defaultValue":"Не созван","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_support","label":"Поддержать созыв","defaultValue":"Поддержать созыв","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_withdraw","label":"Снять подпись","defaultValue":"Снять подпись","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_meaning","label":"Подпись значит «это стоит обсудить всем», а не «я за». За подпись награды нет.","defaultValue":"Подпись значит «это стоит обсудить всем», а не «я за». За подпись награды нет.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_count","label":"Подписей в порог","defaultValue":"Подписей в порог","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_required","label":"Нужно подписей","defaultValue":"Нужно подписей","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_dao","label":"Порог подписей всего ДАО, доля от 0 до 1","defaultValue":"Порог подписей всего ДАО, доля от 0 до 1","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_city","label":"Порог подписей соты, доля от 0 до 1","defaultValue":"Порог подписей соты, доля от 0 до 1","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_days","label":"Срок сбора подписей, дней","defaultValue":"Срок сбора подписей, дней","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_cooldown","label":"Пауза после «не созван», дней","defaultValue":"Пауза после «не созван», дней","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_unset","label":"Пустой порог или пауза — созыв в этом круге не включён. Подпись инициатора в порог не входит.","defaultValue":"Пустой порог или пауза — созыв в этом круге не включён. Подпись инициатора в порог не входит.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.call_create","label":"Вынести вопрос на сбор подписей","defaultValue":"Вынести вопрос на сбор подписей","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.call_title","label":"Вопрос","defaultValue":"Вопрос","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.call_body","label":"Описание вопроса","defaultValue":"Описание вопроса","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.call_circle","label":"Круг","defaultValue":"Круг","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.call_mode","label":"Режим","defaultValue":"Режим","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.call_timing","label":"Время","defaultValue":"Время","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.call_deadline","label":"Дата закрытия голосования (Москва)","defaultValue":"Дата закрытия голосования (Москва)","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.call_deadline_option","label":"До даты","defaultValue":"До даты","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.call_created","label":"Сбор подписей начат.","defaultValue":"Сбор подписей начат.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.call_failed","label":"Созыв не создан. Проверьте параметры и паузу после несостоявшегося созыва.","defaultValue":"Созыв не создан. Проверьте параметры и паузу после несостоявшегося созыва.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_announcement","label":"Сбор подписей за созыв опроса","defaultValue":"Сбор подписей за созыв опроса","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_saved","label":"Подпись обновлена.","defaultValue":"Подпись обновлена.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.signature_failed","label":"Подпись не изменена. Проверьте круг и состояние сбора.","defaultValue":"Подпись не изменена. Проверьте круг и состояние сбора.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.title","label":"Опрос мнений","defaultValue":"Опрос мнений","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.secret","label":"Тайное","defaultValue":"Тайное","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.open","label":"Открытое","defaultValue":"Открытое","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.dao","label":"Всё ДАО","defaultValue":"Всё ДАО","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.city","label":"Сота","defaultValue":"Сота","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.permanent","label":"Перманентное","defaultValue":"Перманентное","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.closed","label":"Закрыто","defaultValue":"Закрыто","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.running","label":"Идёт голосование","defaultValue":"Идёт голосование","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.turnout","label":"Проголосовало","defaultValue":"Проголосовало","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.yes","label":"За","defaultValue":"За","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.no","label":"Против","defaultValue":"Против","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.abstain","label":"Воздержался","defaultValue":"Воздержался","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.close","label":"Закрыть опрос","defaultValue":"Закрыть опрос","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.quorum_reached","label":"Кворум набран","defaultValue":"Кворум набран","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.quorum_missing","label":"Кворум не набран","defaultValue":"Кворум не набран","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.eligible","label":"Участников круга при закрытии","defaultValue":"Участников круга при закрытии","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.hidden","label":"Ход голосования скрыт до закрытия. Голос можно сменить.","defaultValue":"Ход голосования скрыт до закрытия. Голос можно сменить.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.ineligible","label":"Голосуют действующие участники круга с заполненным городом.","defaultValue":"Голосуют действующие участники круга с заполненным городом.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.settings","label":"Настройки Вече","defaultValue":"Настройки Вече","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.settings_hint","label":"Кворум и срок бездействия перманентного опроса","defaultValue":"Кворум и срок бездействия перманентного опроса","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.inactivity","label":"Дней без новых голосов","defaultValue":"Дней без новых голосов","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.inactivity_hint","label":"Пустое поле — срок не задан. Смена уже поданного голоса не продлевает срок.","defaultValue":"Пустое поле — срок не задан. Смена уже поданного голоса не продлевает срок.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.quorum_dao","label":"Кворум всего ДАО, доля от 0 до 1","defaultValue":"Кворум всего ДАО, доля от 0 до 1","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.quorum_city","label":"Кворум соты, доля от 0 до 1","defaultValue":"Кворум соты, доля от 0 до 1","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.quorum_hint","label":"0 — кворум не применяется. Учитываются действующие участники круга с заполненным городом.","defaultValue":"0 — кворум не применяется. Учитываются действующие участники круга с заполненным городом.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.save","label":"Сохранить","defaultValue":"Сохранить","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.saved","label":"Настройки сохранены.","defaultValue":"Настройки сохранены.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.invalid","label":"Проверьте параметры.","defaultValue":"Проверьте параметры.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.vote_saved","label":"Голос учтён.","defaultValue":"Голос учтён.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.vote_failed","label":"Голос не принят. Проверьте доступность опроса.","defaultValue":"Голос не принят. Проверьте доступность опроса.","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.back","label":"К Вече","defaultValue":"К Вече","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.announcement","label":"Созван опрос мнений","defaultValue":"Созван опрос мнений","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.announcement_button","label":"Открыть опрос","defaultValue":"Открыть опрос","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  {"section":"Вече","key":"veche.forum_topic","label":"Вече","defaultValue":"Вече","multiline":false,"pageLabel":"Вече","pageHref":"/veche"},
  { section: "Сигналы", key: "signal.card_title", label: "Название страницы сигнала", defaultValue: "Запись", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.external_brand", label: "Бренд внешней карточки", defaultValue: "ДАО Русь", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.card_respond", label: "Отклик на анонимный сигнал", defaultValue: "Откликнуться", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.reaction_like", label: "Подпись лайка сигнала (для скринридеров)", defaultValue: "Нравится", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.reaction_remove", label: "Снять лайк", defaultValue: "Убрать лайк", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.share", label: "Поделиться сигналом", defaultValue: "Поделиться", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.share_telegram", label: "Передать в Telegram", defaultValue: "Telegram", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.share_vk", label: "Передать во ВКонтакте", defaultValue: "ВКонтакте", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.share_ok", label: "Передать в Одноклассники", defaultValue: "Одноклассники", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.share_whatsapp", label: "Передать в WhatsApp", defaultValue: "WhatsApp", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.share_more", label: "Системный список приложений", defaultValue: "Ещё…", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.share_email", label: "Передать по электронной почте", defaultValue: "Эл. почта", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.share_copy", label: "Скопировать ссылку", defaultValue: "Скопировать ссылку", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.share_copied", label: "Успех копирования", defaultValue: "Ссылка скопирована", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.share_failed", label: "Ошибка копирования", defaultValue: "Не удалось скопировать ссылку.", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.support_network", label: "Поддержка сети", defaultValue: "Поддержать сеть", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.support_unavailable", label: "Недоступность поддержки сети", defaultValue: "Перевод токенов на поддержку сети пока недоступен.", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.owner_profile", label: "Переход к автору", defaultValue: "Перейти к автору", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.back_exchange", label: "Вернуться к обмену", defaultValue: "← К обмену", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.status_active", label: "Состояние active", defaultValue: "Активный", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.status_closed", label: "Состояние closed", defaultValue: "Закрыт", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.status_archived", label: "Состояние archived", defaultValue: "В архиве", multiline: false, pageLabel: "Страница сигнала", pageHref: undefined },
  { section: "Сигналы", key: "signal.new_title", label: "Новый сигнал", defaultValue: "Новая запись", multiline: false },
  { section: "Сигналы", key: "signal.edit_title", label: "Уточнить сигнал", defaultValue: "Уточнить запись", multiline: false },
  { section: "Сигналы", key: "signal.type", label: "Тип сигнала", defaultValue: "Тип записи", multiline: false },
  { section: "Сигналы", key: "signal.label", label: "Краткая формулировка", defaultValue: "Краткая формулировка", multiline: false },
  { section: "Сигналы", key: "signal.label_hint", label: "Одним словом или короткой фразой.", defaultValue: "Одним словом или короткой фразой.", multiline: false },
  { section: "Сигналы", key: "signal.label_placeholder", label: "Например: налоговый юрист", defaultValue: "Например: налоговый юрист", multiline: false },
  { section: "Сигналы", key: "signal.description", label: "Подробности — необязательно", defaultValue: "Подробности — необязательно", multiline: false },
  { section: "Сигналы", key: "signal.description_hint", label: "Уточните условия, контекст или случаи, когда к вам можно обратиться.", defaultValue: "Уточните условия, контекст или случаи, когда к вам можно обратиться.", multiline: false },
  { section: "Сигналы", key: "signal.description_generic", label: "Потребность, возможность или мысль, которой вы хотите поделиться.", defaultValue: "Потребность, возможность или мысль, которой вы хотите поделиться.", multiline: false },
  { section: "Сигналы", key: "signal.description_placeholder", label: "Условия, контекст, подробности", defaultValue: "Условия, контекст, подробности", multiline: false },
  { section: "Сигналы", key: "signal.visibility", label: "Кому видно", defaultValue: "Кому видно", multiline: false },
  { section: "Сигналы", key: "signal.create", label: "Добавить сигнал", defaultValue: "Добавить запись", multiline: false, pageLabel: "Профиль", pageHref: "/profile" },
  { section: "Сигналы", key: "signal.save", label: "Сохранить", defaultValue: "Сохранить", multiline: false },
  { section: "Сигналы", key: "signal.edit", label: "Редактировать", defaultValue: "Редактировать", multiline: false, pageLabel: "Профиль", pageHref: "/profile" },
  { section: "Сигналы", key: "signal.refine", label: "Уточнить формулировку", defaultValue: "Уточнить формулировку", multiline: false, pageLabel: "Профиль", pageHref: "/profile" },
  { section: "Сигналы", key: "signal.legacy_hint", label: "Это прежняя запись свободным текстом. При желании выделите краткую формулировку; исходный текст сохранён ниже без сокращения.", defaultValue: "Это прежняя запись свободным текстом. При желании выделите краткую формулировку; исходный текст сохранён ниже без сокращения.", multiline: false },
  { section: "Сигналы", key: "signal.profile_title", label: "Сигналы", defaultValue: "Записи", multiline: false, pageLabel: "Профиль", pageHref: "/profile" },
  { section: "Сигналы", key: "signal.profile_link", label: "Мой профиль", defaultValue: "Мой профиль", multiline: false },
  { section: "Сигналы", key: "signal.original", label: "Исходная запись", defaultValue: "Исходная запись", multiline: false },
  { section: "Сигналы", key: "signal.invalid", label: "Проверьте тип, видимость и формулировку (до 120 символов). Подробности — до 10000 символов.", defaultValue: "Проверьте тип, видимость и формулировку (до 120 символов). Подробности — до 10000 символов.", multiline: false },
  { section: "Сигналы", key: "signal.empty_types", label: "Сейчас нет доступных типов для создания.", defaultValue: "Сейчас нет доступных типов для создания.", multiline: false },
  { section: "Сигналы", key: "signal.archive", label: "Убрать", defaultValue: "Убрать", multiline: false, pageLabel: "Профиль", pageHref: "/profile" },
  { section: "Сигналы", key: "signal.mine", label: "Ваш сигнал", defaultValue: "Ваша запись", multiline: false, pageLabel: "Обмен", pageHref: "/exchange" },
  { section: "Сигналы", key: "signal.respond", label: "Отозваться", defaultValue: "Отозваться", multiline: false, pageLabel: "Обмен", pageHref: "/exchange" },
  { section: "Сигналы", key: "signal.dating_hint", label: "Подсказка в форме «Ближе»", defaultValue: "Запись скрыта от других участников. Если это можно сказать открыто, в «Ищу» откликнутся быстрее.", multiline: false },
  { section: "Ангел", key: "angel.compose_title", label: "Заголовок помощи в создании сигнала", defaultValue: "Помочь сформулировать с Ангелом", multiline: false },
  { section: "Ангел", key: "angel.compose_placeholder", label: "Подсказка ввода для Ангела", defaultValue: "Опишите своими словами, что вам нужно, что вы умеете или чем хотите поделиться", multiline: true },
  { section: "Ангел", key: "angel.compose_submit", label: "Кнопка предложения Ангела", defaultValue: "Предложить формулировку", multiline: false },
  { section: "Ангел", key: "angel.proposal_title", label: "Заголовок предложения Ангела", defaultValue: "Предложение Ангела", multiline: false },
  { section: "Ангел", key: "angel.proposal_accept", label: "Принять предложение Ангела", defaultValue: "Подставить в форму", multiline: false },
  { section: "Ангел", key: "angel.proposal_cancel", label: "Отменить предложение Ангела", defaultValue: "Отменить", multiline: false },
  { section: "Ангел", key: "angel.search_lead", label: "Пояснение поиска Ангелом", defaultValue: "Ангел поможет найти человека, знание, навык или ресурс.", multiline: false, pageLabel: "Обмен", pageHref: "/exchange" },
  { section: "Ангел", key: "angel.search_placeholder", label: "Подсказка поиска Ангелом", defaultValue: "Например: кто разбирается в ремонте старых домов?", multiline: false, pageLabel: "Обмен", pageHref: "/exchange" },
  { section: "Ангел", key: "angel.search_submit", label: "Кнопка поиска Ангелом", defaultValue: "Найти", multiline: false, pageLabel: "Обмен", pageHref: "/exchange" },
  { section: "Ангел", key: "angel.search_results", label: "Заголовок результатов Ангела", defaultValue: "Ангел нашёл", multiline: false, pageLabel: "Обмен", pageHref: "/exchange" },
  { section: "Ангел", key: "angel.no_results", label: "Нет результатов Ангела", defaultValue: "В доступной вам части Обмена подходящих записей не найдено.", multiline: false, pageLabel: "Обмен", pageHref: "/exchange" },
  { section: "Ангел", key: "angel.out_of_scope", label: "Отказ Ангела вне обмена", defaultValue: "Простите, это не ко мне. Я помогаю только с вопросами обмена: найти людей, знания, навыки, ресурсы, проекты, идеи и возможности в ДАО Русь.", multiline: true },
  { section: "Ангел", key: "angel.suspicious_prompt", label: "Отказ Ангела при подозрительном запросе", defaultValue: "Этот запрос не может быть обработан. Похоже, вы вышли за рамки допустимого. Случайно или намеренно — вот в чём вопрос.", multiline: true },
  { section: "Ангел", key: "angel.unavailable", label: "Ошибка Ангела", defaultValue: "Ангел сейчас не смог обработать запрос. Можно продолжить вручную.", multiline: false },
  { section: "Ангел", key: "angel.rate_limit", label: "Лимит Ангела", defaultValue: "Ангелу нужна короткая передышка. Попробуйте немного позже.", multiline: false },
  { section: "Сигналы", key: "signal.audience_public", label: "Кому видна запись: всем", defaultValue: "Для всех", multiline: false, pageLabel: "Обмен", pageHref: "/exchange" },
  { section: "Сигналы", key: "signal.audience_members", label: "Кому видна запись: только ДАО", defaultValue: "Только ДАО", multiline: false, pageLabel: "Обмен", pageHref: "/exchange" },
  { section: "Сигналы", key: "signal.audience_match", label: "Кому видна запись: только при совпадении", defaultValue: "Только при совпадении", multiline: false, pageLabel: "Обмен", pageHref: "/exchange" },
  { section: "Сигналы", key: "signal.visibility_public", label: "Всем", defaultValue: "Всем", multiline: false },
  { section: "Сигналы", key: "signal.visibility_members", label: "Участникам ДАО", defaultValue: "Участникам ДАО", multiline: false },
  { section: "Сигналы", key: "signal.visibility_circle", label: "Моему кругу", defaultValue: "Моему кругу", multiline: false },
  { section: "Сигналы", key: "signal.visibility_match_only", label: "Только при совпадении", defaultValue: "Только при совпадении", multiline: false },
  { section: "Сигналы", key: "signal.visibility_private", label: "Только мне", defaultValue: "Только мне", multiline: false },
  { section: "Сигналы", key: "signal.visibility_network_blind", label: "Анонимно в сети", defaultValue: "Анонимно в сети", multiline: false },
  ...signalGroupDefaults.map(([key, name]) => ({ section: "Сигналы", key: `signal.group_${key}` as const, label: name, defaultValue: name, multiline: false })),
  ...signalPresentationDefaults.flatMap((type) => [
    ...(["need", "can", "want", "have"].includes(type.key) ? [] : [{ section: "Сигналы", key: `signal.${type.key}.name` as const, label: `${type.name}: название`, defaultValue: type.name, multiline: false }]),
    { section: "Сигналы", key: `signal.${type.key}.description` as const, label: `${type.name}: пояснение`, defaultValue: type.description, multiline: true },
    { section: "Сигналы", key: `signal.${type.key}.example` as const, label: `${type.name}: пример`, defaultValue: type.example, multiline: false },
    { section: "Сигналы", key: `signal.${type.key}.placeholder` as const, label: `${type.name}: placeholder`, defaultValue: type.example, multiline: false },
  ]),

  { section: "Хранитель", key: "signal.discuss", label: "Карточка: кнопка обсуждения", defaultValue: "Обсудить в Telegram", multiline: false },
  { section: "Хранитель", key: "signal.discuss_pending", label: "Карточка: обсуждение публикуется", defaultValue: "Хранитель публикует запись в форуме. Нажмите ещё раз через минуту.", multiline: false },
  { section: "Хранитель", key: "signal.discuss_failed", label: "Карточка: обсуждение не открылось", defaultValue: "Не удалось опубликовать запись в форуме. Попробуйте позже.", multiline: false },
  { section: "Хранитель", key: "forum.discussion_open", label: "Форум: кнопка «открыть запись»", defaultValue: "Открыть запись", multiline: false },
  { section: "Хранитель", key: "forum.discussion_add", label: "Форум: кнопка «добавить свою»", defaultValue: "Добавить свою запись", multiline: false },
  { section: "Хранитель", key: "forum.discussion_withdrawn", label: "Форум: запись снята", defaultValue: "Запись снята автором.", multiline: false },
  { section: "Хранитель", key: "forum.notify_discussion", label: "Уведомление автору об обсуждении", defaultValue: "Вашу запись обсуждают в форуме.", multiline: false },
  { section: "Хранитель", key: "forum.newcomer_title", label: "Объявление новичка: заголовок", defaultValue: "Новый участник", multiline: false },
  { section: "Хранитель", key: "forum.newcomer_city", label: "Объявление новичка: город", defaultValue: "Город", multiline: false },
  { section: "Хранитель", key: "forum.newcomer_interests", label: "Объявление новичка: интересы", defaultValue: "Интересы", multiline: false },
  { section: "Хранитель", key: "forum.newcomer_profile", label: "Объявление новичка: кнопка профиля", defaultValue: "Профиль", multiline: false },
  { section: "Хранитель", key: "forum.newcomer_nearby", label: "Объявление новичка: кнопка «рядом»", defaultValue: "Кто рядом", multiline: false },
  { section: "Хранитель", key: "forum.newcomer_hidden", label: "Объявление новичка скрыто", defaultValue: "Объявление скрыто участником.", multiline: false },
  { section: "Хранитель", key: "guardian.introduction_both", label: "Перенос из рассказа: город и интересы", defaultValue: "Хранитель перенёс в ваш профиль то, что вы рассказывали о себе при вступлении. Город: {city}. Интересы: {interests}. Это видят участники ДАО. Изменить или убрать можно в профиле.", multiline: true },
  { section: "Хранитель", key: "guardian.introduction_city", label: "Перенос из рассказа: только город", defaultValue: "Хранитель перенёс в ваш профиль город, который вы называли при вступлении: {city}. Его видят участники ДАО. Изменить или убрать можно в профиле.", multiline: true },
  { section: "Хранитель", key: "guardian.introduction_interests", label: "Перенос из рассказа: только интересы", defaultValue: "Хранитель перенёс в ваш профиль интересы, которые вы называли при вступлении: {interests}. Их видят участники ДАО. Изменить или убрать можно в профиле.", multiline: true },
  { section: "Хранитель", key: "guardian.introduction_action", label: "Перенос из рассказа: кнопка", defaultValue: "Открыть профиль", multiline: false },
  { section: "Хранитель", key: "forum.departure_test", label: "Проверочное сообщение в канал уходов", defaultValue: "Проверка связи: Хранитель может писать в канал уходов.", multiline: false },
  { section: "Хранитель", key: "forum.test_message", label: "Проверочное сообщение в ветку", defaultValue: "Проверка связи: Хранитель может писать в эту ветку.", multiline: false },
  { section: "Хранитель", key: "profile.announce_in_forum", label: "Профиль: объявить в форуме", defaultValue: "Объявить обо мне в ветке новичков форума, когда я укажу город или интересы", multiline: false },
  { section: "Хранитель", key: "reception.greeting", label: "Приёмная: приветствие по «Запустить»", defaultValue: "Приветствуем! Если Вы ознакомились с кодексом Руси и готовы вступить в ДАО Русь, расскажите немного о себе: возраст, социальный портрет, где живете и чем занимаетесь.", multiline: true },
  { section: "Хранитель", key: "reception.received", label: "Приёмная: рассказ получен", defaultValue: "Спасибо, рассказ передан участникам. Ответим здесь же.", multiline: true },
  { section: "Хранитель", key: "reception.welcome", label: "Приёмная: приветствие после вступления", defaultValue: "Добро пожаловать в ДАО Русь! Укажите город и пару интересов, чтобы вас нашли земляки и единомышленники.", multiline: true },
  { section: "Хранитель", key: "reception.welcome_button", label: "Приёмная: кнопка под приветствием", defaultValue: "Открыть профиль", multiline: false },
  { section: "Хранитель", key: "forum.newcomer_introduction", label: "Объявление новичка: кнопка рассказа", defaultValue: "Представление", multiline: false },
  { section: "Хранитель", key: "guardian.state_title", label: "Состояние участников", defaultValue: "Состояние участников", multiline: false },
  { section: "Хранитель", key: "guardian.composer_title", label: "Сообщение участникам", defaultValue: "Сообщение участникам", multiline: false },
  { section: "Хранитель", key: "guardian.write", label: "Написать", defaultValue: "Написать", multiline: false },
  { section: "Хранитель", key: "guardian.audience", label: "Аудитория", defaultValue: "Аудитория", multiline: false },
  { section: "Хранитель", key: "guardian.all_current", label: "Все актуальные участники", defaultValue: "Все актуальные участники", multiline: false },
  { section: "Хранитель", key: "guardian.without_residence", label: "Без города", defaultValue: "Без города", multiline: false },
  { section: "Хранитель", key: "guardian.without_interests", label: "Без интересов", defaultValue: "Без интересов", multiline: false },
  { section: "Хранитель", key: "guardian.without_bio", label: "Без bio / «О себе»", defaultValue: "Без bio / «О себе»", multiline: false },
  { section: "Хранитель", key: "guardian.without_want", label: "Без активного «Я хочу»", defaultValue: "Без активного «Я хочу»", multiline: false },
  { section: "Хранитель", key: "guardian.without_need", label: "Без активного «Мне нужно»", defaultValue: "Без активного «Мне нужно»", multiline: false },
  { section: "Хранитель", key: "guardian.without_can", label: "Без активного «Я могу»", defaultValue: "Без активного «Я могу»", multiline: false },
  { section: "Хранитель", key: "guardian.without_have", label: "Без активного «У меня есть»", defaultValue: "Без активного «У меня есть»", multiline: false },
  { section: "Хранитель", key: "guardian.never_logged_in", label: "Никогда не входили в Ядро", defaultValue: "Никогда не входили в Ядро", multiline: false },
  { section: "Хранитель", key: "guardian.unverified", label: "Не подтверждены", defaultValue: "Не подтверждены", multiline: false },
  { section: "Хранитель", key: "guardian.city", label: "Выбор по городу", defaultValue: "Выбор по городу", multiline: false },
  { section: "Хранитель", key: "guardian.interests", label: "Выбор по интересам", defaultValue: "Выбор по интересам", multiline: false },
  { section: "Хранитель", key: "guardian.template", label: "Шаблон сообщения", defaultValue: "Шаблон сообщения", multiline: false },
  { section: "Хранитель", key: "guardian.no_template", label: "Без шаблона", defaultValue: "Без шаблона", multiline: false },
  { section: "Хранитель", key: "guardian.city_any", label: "Все города", defaultValue: "Все города", multiline: false },
  { section: "Хранитель", key: "guardian.interests_any", label: "Все интересы", defaultValue: "Все интересы", multiline: false },
  { section: "Хранитель", key: "guardian.audience_help", label: "Условия соединяются И. Несколько интересов — ИЛИ.", defaultValue: "Условия соединяются И. Несколько интересов — ИЛИ.", multiline: false },
  { section: "Хранитель", key: "guardian.preview", label: "Предпросмотр", defaultValue: "Предпросмотр", multiline: false },
  { section: "Хранитель", key: "guardian.preview_title", label: "Предпросмотр сообщения", defaultValue: "Предпросмотр сообщения", multiline: false },
  { section: "Хранитель", key: "guardian.preview_count", label: "Получатели сейчас:", defaultValue: "Получатели сейчас:", multiline: false },
  { section: "Хранитель", key: "guardian.preview_cta", label: "Кнопка действия:", defaultValue: "Кнопка действия:", multiline: false },
  { section: "Хранитель", key: "guardian.preview_channels", label: "Каналы:", defaultValue: "Каналы:", multiline: false },
  { section: "Хранитель", key: "guardian.preview_error", label: "Не удалось подготовить предпросмотр. Повторите попытку.", defaultValue: "Не удалось подготовить предпросмотр. Повторите попытку.", multiline: false },
  { section: "Хранитель", key: "guardian.once_note", label: "Этот системный шаблон отправляется один раз для текущей версии.", defaultValue: "Этот системный шаблон отправляется один раз для текущей версии.", multiline: false },
  { section: "Хранитель", key: "guardian.already_sent", label: "Этот системный шаблон уже отправлен.", defaultValue: "Этот системный шаблон уже отправлен.", multiline: false },
  { section: "Хранитель", key: "guardian.no_channels", label: "Выберите хотя бы один канал.", defaultValue: "Выберите хотя бы один канал.", multiline: false },
  { section: "Хранитель", key: "guardian.unknown_count", label: "Количество будет вычислено в предпросмотре.", defaultValue: "Количество будет вычислено в предпросмотре.", multiline: false },
  { section: "Хранитель", key: "guardian.departures_title", label: "История убытия", defaultValue: "История убытия", multiline: false, pageLabel: "История убытия", pageHref: "/admin/guardian/departures" },
  { section: "Хранитель", key: "guardian.departures_recent", label: "Счётчик за 30 дней", defaultValue: "За последние 30 дней:", multiline: false },
  { section: "Хранитель", key: "guardian.departures_total", label: "Общий счётчик", defaultValue: "Всего зарегистрировано убытий:", multiline: false },
  { section: "Хранитель", key: "guardian.departures_from", label: "Дата начала периода", defaultValue: "С", multiline: false },
  { section: "Хранитель", key: "guardian.departures_to", label: "Дата окончания периода", defaultValue: "По", multiline: false },
  { section: "Хранитель", key: "guardian.departures_filter", label: "Фильтр периода", defaultValue: "Показать", multiline: false },
  { section: "Хранитель", key: "guardian.departures_period", label: "Счётчик за период", defaultValue: "За выбранный период:", multiline: false },
  { section: "Хранитель", key: "guardian.departures_empty", label: "Пустая история", defaultValue: "Зарегистрированных убытий пока нет.", multiline: false, pageLabel: "История убытия", pageHref: "/admin/guardian/departures" },
  { section: "Хранитель", key: "guardian.departure_left", label: "Выход из форума", defaultValue: "Вышел из форума", multiline: false, pageLabel: "История убытия", pageHref: "/admin/guardian/departures" },
  { section: "Хранитель", key: "guardian.departure_removed", label: "Удаление из форума", defaultValue: "Удалён из форума", multiline: false, pageLabel: "История убытия", pageHref: "/admin/guardian/departures" },
  { section: "Хранитель", key: "guardian.arrivals_title", label: "История прибытия", defaultValue: "История прибытия", multiline: false, pageLabel: "История прибытия", pageHref: "/admin/guardian/arrivals" },
  { section: "Хранитель", key: "guardian.arrivals_recent", label: "Прибытие: счётчик за 30 дней", defaultValue: "За последние 30 дней:", multiline: false },
  { section: "Хранитель", key: "guardian.arrivals_total", label: "Прибытие: общий счётчик", defaultValue: "Всего зарегистрировано прибытий:", multiline: false },
  { section: "Хранитель", key: "guardian.arrivals_empty", label: "Пустая история прибытия", defaultValue: "Зарегистрированных прибытий пока нет.", multiline: false, pageLabel: "История прибытия", pageHref: "/admin/guardian/arrivals" },
  { section: "Хранитель", key: "guardian.arrival_joined", label: "Вступление в форум", defaultValue: "Вступил в форум", multiline: false, pageLabel: "История прибытия", pageHref: "/admin/guardian/arrivals" },
  { section: "Хранитель", key: "guardian.arrival_rejoined", label: "Возвращение в форум", defaultValue: "Вернулся в форум", multiline: false, pageLabel: "История прибытия", pageHref: "/admin/guardian/arrivals" },
  { section: "Хранитель", key: "guardian.profile_unavailable", label: "Недоступный профиль", defaultValue: "Профиль недоступен", multiline: false, pageLabel: "История убытия", pageHref: "/admin/guardian/departures" },
  { section: "Хранитель", key: "guardian.broadcast_lead", label: "Аудитория сообщения", defaultValue: "Получатели будут проверены заново перед отправкой.", multiline: false },
  { section: "Хранитель", key: "guardian.message", label: "Поле сообщения", defaultValue: "Сообщение", multiline: false },
  { section: "Хранитель", key: "guardian.channel_core", label: "Канал Ядра", defaultValue: "Ядро", multiline: false },
  { section: "Хранитель", key: "guardian.channel_telegram", label: "Канал Telegram", defaultValue: "Telegram", multiline: false },
  { section: "Хранитель", key: "guardian.send", label: "Кнопка отправки", defaultValue: "Отправить {count}", multiline: false },
  { section: "Хранитель", key: "guardian.result_recipients", label: "Результат — получатели", defaultValue: "Получателей:", multiline: false },
  { section: "Хранитель", key: "guardian.result_core", label: "Результат — Личка", defaultValue: "В Личку Ядра:", multiline: false },
  { section: "Хранитель", key: "guardian.result_telegram", label: "Результат — Telegram", defaultValue: "Telegram поставлено в очередь:", multiline: false },
  { section: "Хранитель", key: "guardian.result_unavailable", label: "Результат — нет доставки", defaultValue: "Без доступной Telegram-доставки:", multiline: false },
  { section: "Навигация", key: "nav.home", label: "Главная", defaultValue: "Главная", multiline: false },
  { section: "Навигация", key: "nav.veche", label: "Вече", defaultValue: "Вече", multiline: false },
  { section: "Навигация", key: "nav.private_messages", label: "Личка", defaultValue: "Личка", multiline: false },
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
  { section: "Главная", key: "home.code_title", label: "Заголовок Кодекса", defaultValue: "Кодекс руси", multiline: false },
  { section: "Главная", key: "onboarding.residence", label: "Первый город", defaultValue: "Укажите город, чтобы найти сообщество рядом", multiline: false },
  { section: "Главная", key: "onboarding.interest", label: "Первый интерес", defaultValue: "Добавьте интерес, чтобы найти единомышленников", multiline: false },
  { section: "Главная", key: "onboarding.need", label: "Первая потребность", defaultValue: "Расскажите, что вам нужно. Награда придёт, когда запись кому-то отзовётся", multiline: false },
  { section: "Главная", key: "onboarding.have", label: "Первое предложение", defaultValue: "Расскажите, что у вас есть. Награда придёт, когда запись кому-то отзовётся", multiline: false },
  { section: "Сеть", key: "participants.title", label: "Заголовок", defaultValue: "Сеть", multiline: false },
  { section: "Сеть", key: "participants.sort_label", label: "Подпись сортировки", defaultValue: "Сортировка:", multiline: false },
  { section: "Сеть", key: "participants.sort_name", label: "Сортировка по имени", defaultValue: "Имя", multiline: false },
  { section: "Сеть", key: "participants.sort_verification", label: "Сортировка по верификации", defaultValue: "Топ-верификация", multiline: false },
  { section: "Сеть", key: "participants.sort_reputation", label: "Сортировка по репутации", defaultValue: "Топ-репутация", multiline: false },
  { section: "Сеть", key: "participants.sort_joined", label: "Сортировка по дате вступления", defaultValue: "Дата вступления", multiline: false },
  { section: "Сеть", key: "participants.sort_core", label: "Показать вошедших в Ядро", defaultValue: "Ядро", multiline: false },
  { section: "Рядом", key: "nearby.title", label: "Заголовок и кнопка раздела", defaultValue: "Рядом", multiline: false },
  { section: "Рядом", key: "nearby.lead", label: "Подзаголовок", defaultValue: "Участники ДАО по месту жительства.", multiline: false },
  { section: "Рядом", key: "nearby.empty", label: "Пустой список", defaultValue: "Сообществ по месту жительства пока нет.", multiline: false },
  { section: "Сообщества", key: "community.residence_title", label: "Префикс заголовка места", defaultValue: "Сообщество", multiline: false },
  { section: "Сообщества", key: "community.interest_title", label: "Префикс заголовка интереса", defaultValue: "Сообщество", multiline: false },
  { section: "Сообщества", key: "community.members_title", label: "Заголовок списка участников", defaultValue: "Участники", multiline: false },
  { section: "Сообщества", key: "community.feed_title", label: "Заголовок ленты", defaultValue: "Объявления сообщества", multiline: false },
  { section: "Сообщества", key: "community.feed_empty", label: "Пустая лента", defaultValue: "Объявлений пока нет.", multiline: false },
  { section: "Обмен", key: "exchange.title", label: "Заголовок", defaultValue: "Обмен", multiline: false },
  { section: "Обмен", key: "exchange.lead", label: "Вводный текст", defaultValue: "Здесь люди находят друг друга через потребности, возможности, знания, навыки, идеи и дела.", multiline: true },
  { section: "Обмен", key: "exchange.privacy_hint", label: "Подсказка об анонимности", defaultValue: "Анонимные записи опубликованы без имени автора. Не указывайте в них данные, по которым вас можно легко узнать.", multiline: true },
  { section: "Обмен", key: "exchange.empty", label: "Пустой список сигналов", defaultValue: "Записей пока нет.", multiline: false },
  { section: "Ближе", key: "closer.goal", label: "Поле: цель", defaultValue: "Цель", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.city", label: "Поле: город", defaultValue: "Город", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.city_mine", label: "Город: вариант «мой город»", defaultValue: "Мой город", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.city_any", label: "Город: вариант «неважен»", defaultValue: "Неважен", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.city_missing", label: "Город не указан в профиле", defaultValue: "Город не указан в профиле. Укажите его там или выберите «Неважен».", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.self", label: "Поле: я", defaultValue: "Я", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.seeks", label: "Поле: ищу", defaultValue: "Ищу", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.gender_m", label: "Пол: мужчина", defaultValue: "Мужчина", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.gender_f", label: "Пол: женщина", defaultValue: "Женщина", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.gender_self_none", label: "Я: не указывать", defaultValue: "Не указывать", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.gender_any", label: "Ищу: неважно", defaultValue: "Неважно", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.keys_hint", label: "Пояснение к ключам", defaultValue: "Совпадение ищется только по этим полям. Текст в подборе не участвует.", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.description_hint", label: "Пояснение к подробностям", defaultValue: "Подробности увидит только человек, с которым совпали ключи, и без вашего имени. Они помогают понять, тот ли это случай. Не пишите того, по чему вас легко узнать.", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.limit", label: "Превышен лимит записей", defaultValue: "В разделе может быть не больше трёх активных записей. Уберите одну из прежних.", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.matches_title", label: "Заголовок совпадений", defaultValue: "Совпадения", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.matches_empty", label: "Совпадений нет", defaultValue: "Совпадений пока нет. Когда появятся, вам сообщит Хранитель.", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.open_dialog", label: "Кнопка: начать разговор", defaultValue: "Начать анонимный разговор", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.continue_dialog", label: "Кнопка: открыть разговор", defaultValue: "Открыть разговор", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.no_keys", label: "Запись без ключей", defaultValue: "Цель и город не выбраны: запись не участвует в подборе", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.draft", label: "Запись-черновик", defaultValue: "Черновик: в подборе не участвует", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Ближе", key: "closer.notify_match", label: "Уведомление о совпадении", defaultValue: "В разделе «Ближе» есть совпадение.", multiline: false },
  { section: "Ближе", key: "closer.notify_dialog", label: "Уведомление о разговоре", defaultValue: "В разделе «Ближе» с вами начали анонимный разговор.", multiline: false },
  { section: "Ближе", key: "closer.notify_action", label: "Уведомление: кнопка", defaultValue: "Открыть", multiline: false },
  { section: "Обмен", key: "exchange.closer_intro", label: "«Ближе»: как устроен раздел", defaultValue: "Опишите, кого вы хотите найти, и выберите цель и город. Запись скрыта от других участников, и никто из них не видит, что вы сюда писали.\n\nКогда цель и город двух записей совпадут, оба автора одновременно увидят записи друг друга без имён. Любой из двоих может начать анонимный разговор и по ходу решить, раскрываться или нет.", multiline: true, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Обмен", key: "exchange.closer_own_title", label: "«Ближе»: заголовок своих записей", defaultValue: "Ваши записи", multiline: false, pageLabel: "Обмен", pageHref: "/exchange?type=dating" },
  { section: "Обмен", key: "reward.record_responded", label: "Награда: подпись, когда запись отозвалась", defaultValue: "Ваша запись встретила отклик", multiline: false },
  { section: "Обмен", key: "exchange.sort_new", label: "Сортировка: новые", defaultValue: "Новые", multiline: false },
  { section: "Обмен", key: "exchange.sort_top", label: "Сортировка: по лайкам", defaultValue: "Топ", multiline: false },
  { section: "Обмен", key: "exchange.sort_label", label: "Сортировка: подпись", defaultValue: "Порядок записей", multiline: false },
  { section: "Обмен", key: "exchange.hidden_link", label: "Ссылка на скрытые записи", defaultValue: "Скрытых записей", multiline: false },
  { section: "Обмен", key: "exchange.hidden_title", label: "Заголовок скрытых записей", defaultValue: "Скрытые записи", multiline: false },
  { section: "Обмен", key: "exchange.hidden_empty", label: "Нет скрытых записей", defaultValue: "Вы ничего не скрывали.", multiline: false },
  { section: "Обмен", key: "signal.hide", label: "Кнопка: скрыть для себя", defaultValue: "Скрыть для себя", multiline: false },
  { section: "Обмен", key: "signal.unhide", label: "Кнопка: вернуть в ленту", defaultValue: "Вернуть в ленту", multiline: false },
  { section: "Обмен", key: "signal.hidden_note", label: "Пометка на скрытой записи", defaultValue: "Вы скрыли эту запись из своей ленты. Автор об этом не знает.", multiline: false },
  { section: "Обмен", key: "signal.views", label: "Подпись счётчика просмотров", defaultValue: "Просмотров", multiline: false },
  { section: "Обмен", key: "exchange.tab_need", label: "Категория Нужно", defaultValue: "? Нужно", multiline: false },
  { section: "Обмен", key: "exchange.tab_can", label: "Категория Могу", defaultValue: "! Могу", multiline: false },
  { section: "Обмен", key: "exchange.tab_want", label: "Категория Хочу", defaultValue: "♥ Хочу", multiline: false },
  { section: "Обмен", key: "exchange.tab_have", label: "Категория Есть", defaultValue: "+ Есть", multiline: false },
  { section: "Обмен", key: "exchange.add_need", label: "Добавить Нужно", defaultValue: "Добавить «Мне нужно»", multiline: false },
  { section: "Обмен", key: "exchange.add_can", label: "Добавить Могу", defaultValue: "Добавить «Я могу»", multiline: false },
  { section: "Обмен", key: "exchange.add_want", label: "Добавить Хочу", defaultValue: "Добавить «Я хочу»", multiline: false },
  { section: "Обмен", key: "exchange.add_have", label: "Добавить Есть", defaultValue: "Добавить «У меня есть»", multiline: false },
  { section: "Мне нужно", key: "need.title", label: "Заголовок", defaultValue: "Что вам нужно?", multiline: false },
  { section: "Мне нужно", key: "need.lead", label: "Вводный текст", defaultValue: "Опишите потребность своими словами. Запись появится в вашем профиле.", multiline: true },
  { section: "Диалоги", key: "relay.notify_response", label: "Уведомление автору об отклике", defaultValue: "На вашу запись откликнулись.", multiline: false },
  { section: "Диалоги", key: "relay.notify_action", label: "Уведомление об отклике: кнопка", defaultValue: "Открыть диалог", multiline: false },
  { section: "Диалоги", key: "relay.list_title", label: "Заголовок списка", defaultValue: "Диалоги", multiline: false },
  { section: "Диалоги", key: "relay.archive_title", label: "Заголовок архива", defaultValue: "Архив диалогов", multiline: false, pageLabel: "Архив диалогов", pageHref: "/relay?archive=1" },
  { section: "Диалоги", key: "relay.dialog_title", label: "Заголовок диалога", defaultValue: "Диалог", multiline: false, pageLabel: "Диалог", pageHref: undefined },
  { section: "Диалоги", key: "relay.list_empty", label: "Пустой список диалогов", defaultValue: "Активных диалогов пока нет.", multiline: false },
  { section: "Диалоги", key: "relay.archive_empty", label: "Пустой архив", defaultValue: "Архив пуст.", multiline: false, pageLabel: "Архив диалогов", pageHref: "/relay?archive=1" },
  { section: "Диалоги", key: "relay.messages_empty", label: "Пустая переписка", defaultValue: "Сообщений пока нет.", multiline: false, pageLabel: "Диалог", pageHref: undefined },
  { section: "Профиль", key: "profile.eyebrow", label: "Надпись над именем в профиле", defaultValue: "Профиль", multiline: false },
  { section: "Профиль", key: "profile.forum_since", label: "Дата вступления в ДАО", defaultValue: "В ДАО с", multiline: false },
  { section: "Профиль", key: "profile.write_telegram", label: "Чужой профиль: кнопка «написать»", defaultValue: "Написать в Telegram", multiline: false },
  { section: "Профиль", key: "profile.not_logged_in", label: "Чужой профиль: ещё не входил в Ядро", defaultValue: "Ещё не входил в Ядро", multiline: false },
  { section: "Профиль", key: "profile.left_forum", label: "Чужой профиль: покинул форум", defaultValue: "Покинул форум", multiline: false },
  { section: "Профиль", key: "profile.left_dao", label: "Чужой профиль: вышел из ДАО", defaultValue: "Вышел из ДАО", multiline: false },
  { section: "Профиль", key: "profile.telegram_bio", label: "Чужой профиль: подпись к описанию из Telegram", defaultValue: "Из Telegram", multiline: false },
  { section: "Профиль", key: "profile.trust_title", label: "Чужой профиль: заголовок блока доверия", defaultValue: "Доверие", multiline: false },
  { section: "Профиль", key: "profile.positive_button", label: "Чужой профиль: кнопка хорошего опыта", defaultValue: "Отметить хороший опыт", multiline: false },
  { section: "Профиль", key: "profile.report_problem", label: "Чужой профиль: сообщить о проблеме", defaultValue: "Сообщить Хранителям о проблеме", multiline: false },
  { section: "Профиль", key: "profile.reception_link", label: "Ссылка на Приёмную", defaultValue: "Открыть Приёмную ДАО Русь", multiline: false },
  { section: "Награды", key: "award.title", label: "Награды", defaultValue: "Награды", multiline: false },
  { section: "Награды", key: "award.registry", label: "Реестр наград", defaultValue: "Реестр наград", multiline: false },
  { section: "Награды", key: "award.establish", label: "Учредить награду", defaultValue: "Учредить награду", multiline: false },
  { section: "Награды", key: "award.name", label: "Название", defaultValue: "Название", multiline: false },
  { section: "Награды", key: "award.slug", label: "Slug", defaultValue: "Slug", multiline: false },
  { section: "Награды", key: "award.image", label: "Изображение (PNG, JPEG, WebP, до 5 МБ)", defaultValue: "Изображение (PNG, JPEG, WebP, до 5 МБ)", multiline: false },
  { section: "Награды", key: "award.establishedOn", label: "Дата учреждения", defaultValue: "Дата учреждения", multiline: false },
  { section: "Награды", key: "award.description", label: "Описание", defaultValue: "Описание", multiline: false },
  { section: "Награды", key: "award.criterion", label: "Критерий", defaultValue: "Критерий", multiline: false },
  { section: "Награды", key: "award.publicAddress", label: "Публичное обращение учредителя", defaultValue: "Публичное обращение учредителя", multiline: false },
  { section: "Награды", key: "award.kind", label: "Характер награды", defaultValue: "Характер награды", multiline: false },
  { section: "Награды", key: "award.historical", label: "Историческая", defaultValue: "Историческая", multiline: false },
  { section: "Награды", key: "award.open", label: "Открытая", defaultValue: "Открытая", multiline: false },
  { section: "Награды", key: "award.historicalCutoffAt", label: "Историческая граница (ISO, с часовым поясом)", defaultValue: "Историческая граница (ISO, с часовым поясом)", multiline: false },
  { section: "Награды", key: "award.regular", label: "Обычный выпуск", defaultValue: "Обычный выпуск", multiline: false },
  { section: "Награды", key: "award.remint", label: "Дочеканка", defaultValue: "Дочеканка", multiline: false },
  { section: "Награды", key: "award.createBatch", label: "Создать выпуск", defaultValue: "Создать выпуск", multiline: false },
  { section: "Награды", key: "award.batches", label: "История выпусков", defaultValue: "История выпусков", multiline: false },
  { section: "Награды", key: "award.draft", label: "Черновик", defaultValue: "Черновик", multiline: false },
  { section: "Награды", key: "award.finalized", label: "Зафиксирован", defaultValue: "Зафиксирован", multiline: false },
  { section: "Награды", key: "award.candidates", label: "Предварительный список", defaultValue: "Предварительный список", multiline: false },
  { section: "Награды", key: "award.filters", label: "Поиск аудитории", defaultValue: "Поиск аудитории", multiline: false },
  { section: "Награды", key: "award.filterHint", label: "Фильтр помогает найти людей. Право на награду определяет Учредитель вручную. Добавление по фильтру сохраняет прежние правки списка.", defaultValue: "Фильтр помогает найти людей. Право на награду определяет Учредитель вручную. Добавление по фильтру сохраняет прежние правки списка.", multiline: false },
  { section: "Награды", key: "award.city", label: "Город", defaultValue: "Город", multiline: false },
  { section: "Награды", key: "award.interests", label: "Интересы", defaultValue: "Интересы", multiline: false },
  { section: "Награды", key: "award.conditions", label: "Заполненность профиля", defaultValue: "Заполненность профиля", multiline: false },
  { section: "Награды", key: "award.membership", label: "Членство", defaultValue: "Членство", multiline: false },
  { section: "Награды", key: "award.verification", label: "Верификация", defaultValue: "Верификация", multiline: false },
  { section: "Награды", key: "award.verified", label: "Подтверждён", defaultValue: "Подтверждён", multiline: false },
  { section: "Награды", key: "award.unverified", label: "Не подтверждён", defaultValue: "Не подтверждён", multiline: false },
  { section: "Награды", key: "award.all", label: "Любые", defaultValue: "Любые", multiline: false },
  { section: "Награды", key: "award.snapshot", label: "Добавить кандидатов по фильтру", defaultValue: "Добавить кандидатов по фильтру", multiline: false },
  { section: "Награды", key: "award.manual", label: "Добавить существующего участника", defaultValue: "Добавить существующего участника", multiline: false },
  { section: "Награды", key: "award.included", label: "Включён", defaultValue: "Включён", multiline: false },
  { section: "Награды", key: "award.excluded", label: "Исключён", defaultValue: "Исключён", multiline: false },
  { section: "Награды", key: "award.filter", label: "Фильтр", defaultValue: "Фильтр", multiline: false },
  { section: "Награды", key: "award.source", label: "Источник", defaultValue: "Источник", multiline: false },
  { section: "Награды", key: "award.reason", label: "Основание награждения", defaultValue: "Основание награждения", multiline: false },
  { section: "Награды", key: "award.personalAddress", label: "Персональное памятное обращение", defaultValue: "Персональное памятное обращение", multiline: false },
  { section: "Награды", key: "award.save", label: "Сохранить", defaultValue: "Сохранить", multiline: false },
  { section: "Награды", key: "award.finalize", label: "Зафиксировать выпуск", defaultValue: "Зафиксировать выпуск", multiline: false },
  { section: "Награды", key: "award.finalizeWarning", label: "Подтверждаю список и основания. После фиксации редактирование выпуска невозможно.", defaultValue: "Подтверждаю список и основания. После фиксации редактирование выпуска невозможно.", multiline: false },
  { section: "Награды", key: "award.conflict", label: "Участник уже имеет экземпляр этой награды. Исключите его из выпуска.", defaultValue: "Участник уже имеет экземпляр этой награды. Исключите его из выпуска.", multiline: false },
  { section: "Награды", key: "award.invalid", label: "Проверьте данные: для каждого включённого участника требуется основание, изображение должно быть PNG/JPEG/WebP, историческая граница — ISO с часовым поясом.", defaultValue: "Проверьте данные: для каждого включённого участника требуется основание, изображение должно быть PNG/JPEG/WebP, историческая граница — ISO с часовым поясом.", multiline: false },
  { section: "Награды", key: "award.state", label: "Действие недоступно в текущем состоянии.", defaultValue: "Действие недоступно в текущем состоянии.", multiline: false },
  { section: "Награды", key: "award.saved", label: "Сохранено.", defaultValue: "Сохранено.", multiline: false },
  { section: "Награды", key: "award.offered", label: "Предложена", defaultValue: "Предложена", multiline: false },
  { section: "Награды", key: "award.declined", label: "От предложения отказались; принять ещё возможно", defaultValue: "От предложения отказались; принять ещё возможно", multiline: false },
  { section: "Награды", key: "award.accepted", label: "Принята", defaultValue: "Принята", multiline: false },
  { section: "Награды", key: "award.rejected", label: "Окончательно отвергнута", defaultValue: "Окончательно отвергнута", multiline: false },
  { section: "Награды", key: "award.accept", label: "Принять награду", defaultValue: "Принять награду", multiline: false },
  { section: "Награды", key: "award.decline", label: "Отказаться от предложения", defaultValue: "Отказаться от предложения", multiline: false },
  { section: "Награды", key: "award.reject", label: "Окончательно отвергнуть награду", defaultValue: "Окончательно отвергнуть награду", multiline: false },
  { section: "Награды", key: "award.rejectWarning", label: "Отвержение необратимо. Повторно принять или получить эту же награду будет невозможно.", defaultValue: "Отвержение необратимо. Повторно принять или получить эту же награду будет невозможно.", multiline: false },
  { section: "Награды", key: "award.rejectConfirm", label: "Я понимаю последствия и окончательно отвергаю награду", defaultValue: "Я понимаю последствия и окончательно отвергаю награду", multiline: false },
  { section: "Награды", key: "award.showInPublicList", label: "Показывать меня в публичном списке награды", defaultValue: "Показывать меня в публичном списке награды", multiline: false },
  { section: "Награды", key: "award.showNextToName", label: "Показывать знак рядом с моим никнеймом", defaultValue: "Показывать знак рядом с моим никнеймом", multiline: false },
  { section: "Награды", key: "award.publicPage", label: "Публичная страница награды", defaultValue: "Публичная страница награды", multiline: false },
  { section: "Награды", key: "award.recipients", label: "Приняли награду и разрешили показ", defaultValue: "Приняли награду и разрешили показ", multiline: false },
  { section: "Награды", key: "award.empty", label: "Пока никого.", defaultValue: "Пока никого.", multiline: false },
  { section: "Награды", key: "award.login", label: "Войти для просмотра предложения", defaultValue: "Войти для просмотра предложения", multiline: false },
  { section: "Награды", key: "award.personalLink", label: "Персональная ссылка", defaultValue: "Персональная ссылка", multiline: false },
  { section: "Награды", key: "award.copy", label: "Скопировать ссылку", defaultValue: "Скопировать ссылку", multiline: false },
  { section: "Награды", key: "award.copied", label: "Ссылка скопирована", defaultValue: "Ссылка скопирована", multiline: false },
  { section: "Награды", key: "award.offeredAt", label: "Предложена", defaultValue: "Предложена", multiline: false },
  { section: "Награды", key: "award.declinedAt", label: "Отказ от предложения", defaultValue: "Отказ от предложения", multiline: false },
  { section: "Награды", key: "award.acceptedAt", label: "Принята", defaultValue: "Принята", multiline: false },
  { section: "Награды", key: "award.rejectedAt", label: "Отвергнута", defaultValue: "Отвергнута", multiline: false },
  { section: "Награды", key: "award.awarder", label: "Награждающий", defaultValue: "Награждающий", multiline: false },
  { section: "Награды", key: "award.own", label: "Мои награды", defaultValue: "Мои награды", multiline: false },
  { section: "Награды", key: "award.none", label: "Членство не установлено", defaultValue: "Членство не установлено", multiline: false },
  { section: "Награды", key: "award.participant", label: "Участник", defaultValue: "Участник", multiline: false },
  { section: "Награды", key: "award.left", label: "Вышел", defaultValue: "Вышел", multiline: false },
  { section: "Награды", key: "award.excludedMembership", label: "Исключён", defaultValue: "Исключён", multiline: false },
  { section: "Награды", key: "award.without_residence", label: "Без места жительства", defaultValue: "Без места жительства", multiline: false },
  { section: "Награды", key: "award.without_interests", label: "Без интересов", defaultValue: "Без интересов", multiline: false },
  { section: "Награды", key: "award.without_bio", label: "Без рассказа о себе", defaultValue: "Без рассказа о себе", multiline: false },
  { section: "Награды", key: "award.without_want", label: "Без «хочу»", defaultValue: "Без «хочу»", multiline: false },
  { section: "Награды", key: "award.without_need", label: "Без «нужно»", defaultValue: "Без «нужно»", multiline: false },
  { section: "Награды", key: "award.without_can", label: "Без «могу»", defaultValue: "Без «могу»", multiline: false },
  { section: "Награды", key: "award.without_have", label: "Без «есть»", defaultValue: "Без «есть»", multiline: false },
  { section: "Награды", key: "award.never_logged_in", label: "Ещё не входили в Core", defaultValue: "Ещё не входили в Core", multiline: false },
  { section: "Награды", key: "award.authority", label: "Учредитель", defaultValue: "Учредитель", multiline: false },
  { section: "Награды", key: "award.count", label: "Всего", defaultValue: "Всего", multiline: false },
  { section: "Награды", key: "award.ownOffer", label: "Заголовок личного предложения на странице награды", defaultValue: "Вам предложена эта награда", multiline: false },
  { section: "Награды", key: "award.loginIfOffered", label: "Вход на странице награды для тех, кому её могли предложить", defaultValue: "Если эта награда предложена вам, войдите, чтобы увидеть предложение", multiline: false },
  { section: "Награды", key: "award.notify", label: "Кнопка: уведомить получателей выпуска", defaultValue: "Уведомить получателей в Telegram", multiline: false },
  { section: "Награды", key: "award.notifyHint", label: "Пояснение к уведомлению получателей", defaultValue: "Каждому, кому награда ещё только предложена, придёт одно уведомление со ссылкой на личное предложение. Повторное нажатие не создаёт дублей. Ссылку можно по-прежнему передать вручную.", multiline: true },
  { section: "Награды", key: "award.notifyText", label: "Текст уведомления о предложенной награде ({name} — название награды)", defaultValue: "Вам предложена награда ДАО Русь «{name}». Откройте предложение, чтобы принять её или отказаться.", multiline: true },
  { section: "Награды", key: "award.notifyAction", label: "Кнопка в уведомлении о предложенной награде", defaultValue: "Открыть предложение", multiline: false },
  { section: "Награды", key: "award.notified", label: "Уведомления поставлены в очередь.", defaultValue: "Уведомления поставлены в очередь.", multiline: false },
  { section: "Награды", key: "award.nothingToNotify", label: "Новых уведомлений нет: все получатели уже уведомлены или ответили на предложение.", defaultValue: "Новых уведомлений нет: все получатели уже уведомлены или ответили на предложение.", multiline: false },
] as const;

type PageContext = { pageLabel: string; pageHref?: string };

const pageContextBySection: Record<(typeof interfaceTextFieldDefinitions)[number]["section"], PageContext> = {
  "Сигналы": { pageLabel: "Создание сигнала", pageHref: "/exchange/new" },
  "Ангел": { pageLabel: "Создание сигнала", pageHref: "/exchange/new" },
  "Хранитель": { pageLabel: "Хранитель", pageHref: "/admin/guardian" },
  "Навигация": { pageLabel: "Общий интерфейс" },
  "Главная": { pageLabel: "Главная", pageHref: "/" },
  "Сеть": { pageLabel: "Сеть", pageHref: "/participants" },
  "Рядом": { pageLabel: "Рядом", pageHref: "/nearby" },
  "Сообщества": { pageLabel: "Сообщества", pageHref: "/participants" },
  "Обмен": { pageLabel: "Обмен", pageHref: "/exchange" },
  "Ближе": { pageLabel: "Обмен · Ближе", pageHref: "/exchange?type=dating" },
  "Мне нужно": { pageLabel: "Мне нужно", pageHref: "/need" },
  "Диалоги": { pageLabel: "Диалоги", pageHref: "/relay" },
  "Профиль": { pageLabel: "Профиль", pageHref: "/profile" },
  "Награды": { pageLabel: "Награды", pageHref: "/admin/awards" },
};

export const interfaceTextFields = interfaceTextFieldDefinitions.map((field) => ({
  ...pageContextBySection[field.section],
  ...field,
}));

export type InterfaceTextKey = (typeof interfaceTextFields)[number]["key"];
export type InterfaceTextValues = Record<InterfaceTextKey, string>;
export type InterfaceTextOverrides = Record<InterfaceTextKey, string | null>;

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type InterfaceTextClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};
export type InterfaceTextDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<InterfaceTextClient>;
};

const keys = interfaceTextFields.map((field) => field.key);

export class InterfaceTextValidationError extends Error {
  constructor() {
    super("Invalid interface text");
    this.name = "InterfaceTextValidationError";
  }
}

export async function readInterfaceTextsWithDatabase(
  database: Pick<InterfaceTextDatabase, "query">,
): Promise<{ values: InterfaceTextValues; overrides: InterfaceTextOverrides }> {
  const values = Object.fromEntries(
    interfaceTextFields.map((field) => [field.key, field.defaultValue]),
  ) as InterfaceTextValues;
  const overrides = Object.fromEntries(
    interfaceTextFields.map((field) => [field.key, null]),
  ) as InterfaceTextOverrides;
  const result = await database.query(
    "SELECT key, value FROM ui_text_overrides WHERE key = ANY($1::text[])",
    [keys],
  );
  for (const row of result.rows) {
    if (!keys.includes(row.key as InterfaceTextKey)) continue;
    const key = row.key as InterfaceTextKey;
    const value = String(row.value);
    values[key] = value;
    overrides[key] = value;
  }
  return { values, overrides };
}

export async function readInterfaceTexts() {
  const { pool } = await import("./db");
  return readInterfaceTextsWithDatabase(pool);
}

export function parseInterfaceTextForm(formData: FormData): InterfaceTextOverrides {
  const overrides = {} as InterfaceTextOverrides;
  for (const field of interfaceTextFields) {
    if (formData.get(`reset.${field.key}`) === "on") {
      overrides[field.key] = null;
      continue;
    }
    const value = formData.get(field.key);
    if (typeof value !== "string") {
      throw new InterfaceTextValidationError();
    }
    const normalized = value.trim();
    overrides[field.key] = normalized === field.defaultValue ? null : normalized;
  }
  return overrides;
}

export async function saveInterfaceTextsWithDatabase(
  database: Pick<InterfaceTextDatabase, "connect">,
  actorId: string,
  desired: InterfaceTextOverrides,
): Promise<InterfaceTextKey[]> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE ui_text_overrides IN SHARE ROW EXCLUSIVE MODE");
    const currentResult = await client.query(
      "SELECT key, value FROM ui_text_overrides WHERE key = ANY($1::text[])",
      [keys],
    );
    const current = new Map(currentResult.rows.map((row) => [String(row.key), String(row.value)]));
    const changedKeys: InterfaceTextKey[] = [];

    for (const field of interfaceTextFields) {
      const next = desired[field.key];
      if (next === undefined) {
        throw new InterfaceTextValidationError();
      }
      const previous = current.get(field.key) ?? null;
      if (previous === next) continue;
      if (next === null) {
        await client.query("DELETE FROM ui_text_overrides WHERE key = $1", [field.key]);
      } else {
        await client.query(
          `INSERT INTO ui_text_overrides(key, value)
           VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_at = now()`,
          [field.key, next],
        );
      }
      changedKeys.push(field.key);
    }

    if (changedKeys.length) {
      await client.query(
        `INSERT INTO events(event_type, participant_id, payload)
         VALUES ('interface.texts_updated', $1, $2::jsonb)`,
        [actorId, JSON.stringify({ changed_by_participant_id: actorId, keys: changedKeys })],
      );
    }
    await client.query("COMMIT");
    return changedKeys;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function saveInterfaceTexts(actorId: string, desired: InterfaceTextOverrides) {
  const { pool } = await import("./db");
  return saveInterfaceTextsWithDatabase(pool, actorId, desired);
}
