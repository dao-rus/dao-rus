import { signalPresentationDefaults, signalGroupDefaults } from "./signal-presentation";

const interfaceTextFieldDefinitions = [
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
  { section: "Хранитель", key: "guardian.departures_empty", label: "Пустая история", defaultValue: "Зарегистрированных убытий пока нет.", multiline: false, pageLabel: "История убытия", pageHref: "/admin/guardian/departures" },
  { section: "Хранитель", key: "guardian.departure_left", label: "Выход из форума", defaultValue: "Вышел из форума", multiline: false, pageLabel: "История убытия", pageHref: "/admin/guardian/departures" },
  { section: "Хранитель", key: "guardian.departure_removed", label: "Удаление из форума", defaultValue: "Удалён из форума", multiline: false, pageLabel: "История убытия", pageHref: "/admin/guardian/departures" },
  { section: "Хранитель", key: "guardian.profile_unavailable", label: "Недоступный профиль", defaultValue: "Профиль недоступен", multiline: false, pageLabel: "История убытия", pageHref: "/admin/guardian/departures" },
  { section: "Хранитель", key: "guardian.back", label: "Вернуться к Хранителю", defaultValue: "К Хранителю", multiline: false, pageLabel: "История убытия", pageHref: "/admin/guardian/departures" },
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
  { section: "Профиль", key: "profile.reception_link", label: "Ссылка на Приёмную", defaultValue: "Открыть Приёмную ДАО Русь", multiline: false },
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
