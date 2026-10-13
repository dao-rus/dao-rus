// Раздел «Ангел» реестра надписей интерфейса.
export const angelTexts = [
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
] as const;
