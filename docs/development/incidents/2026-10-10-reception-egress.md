# Сбой доставки Приёмной 2026-10-10

Состояние: исходящий доступ production к Telegram заблокирован сетевой проблемой;
полное восстановление и реальные двусторонние тесты ещё не подтверждены.

## Подтверждённая причина

Web container не может установить HTTPS-соединение к api.telegram.org:443.
Read-only getMe завершился `UND_ERR_CONNECT_TIMEOUT`. curl на самом host:
IPv4 — `curl: (28) Connection timed out after 8002 milliseconds`,
IPv6 — `curl: (7) Failed to connect to api.telegram.org port 443`.
GitHub доступен. OUTPUT policy ACCEPT, ufw-user-output пуст, DOCKER-USER без
правил. Нет hosts override; запрос Google DNS возвращает тот же A record.
Это подтверждает сетевой сбой вне relay-кода; конкретный источник фильтрации или
маршрутная неисправность у провайдера пока не установлены. Не менялись DNS,
маршруты, firewall, credentials, webhook и транспорт; обходной proxy не создавался.

В runtime Reception token/secret и forum config присутствуют, username настроен
как Daorus_bot, topic 1 (General). Secrets не выводились и не копировались.
Идентичность бота по getMe, webhook URL/allowed_updates/pending updates и текущие
права бота нельзя подтвердить без доступного Bot API. Входящие webhook-запросы
поступают: последние получают HTTP 200. Предыдущие 400 относятся к 7 октября до
12:56:49 UTC, шесть 502 — к deploy 7 октября около 22:13 UTC. Эти HTTP-коды не
равны error_code Telegram в таблице доставки.

## Снимок последних 72 часов

Первый снимок: 19 relay updates — 15 sent, 4 failed. Две последние записи
private_to_forum поступили в 10:29 и 10:30 UTC и завершились таймаутами ровно
примерно через пять секунд. Они подтверждают приём обновлений webhook; тексты
сообщений в БД не хранятся, принадлежность тестам владельца отдельно не сверена.
Во время расследования поступили ещё две private_to_forum timeout-записи.

Последний снимок перед повторным deploy:

| Направление | sent | failed | Причина failed |
|---|---:|---:|---|
| private_to_forum | 9 | 4 | network_or_timeout; два разных private чата |
| forum_to_private | 6 | 2 | один network_or_timeout, один прежний telegram_400 |

Pending во всей таблице: 0. У всех шести failed-записей есть исходный message ID;
сохранённых заголовков у этих записей нет. Маршрутизация private→forum и
forum reply→private проверена по существующему коду и тестам: ответ ищется по
успешному forum message/heading ID, получатель берётся из mapping, не из ввода
отвечающего. General topic требует отсутствия message_thread_id на отправке.

Число затронутых соискателей и отсутствие у них других сообщений не подтверждены:
без меток теста/времени от отправителя и без проверки Telegram их нельзя вывести
из routing metadata. Отсутствующая запись не доказывает, что сообщение не было
отправлено пользователем или webhook пропал. Сброс webhook и drop_pending_updates не использовались.

## Исправление обработки отказов

- 9a0b90d: безопасные категории Telegram ошибок вместо произвольных descriptions,
  structured error log с update ID/направлением/действием восстановления.
- Форматирование повторно отправляется без entities только после явного
  telegram_400_parse_entities. Timeout, network error, invalid response и 5xx не
  вызывают повторную отправку.
- ID успешного заголовка сохраняется до copyMessage, включая последующий отказ.
- Ручная recovery CLI выбирает одну запись, проверяет текущий forum target,
  исходный message ID, возраст операции и retry_after, claims через PostgreSQL CAS
  по status/error_code/полной строке timestamp с микросекундами.
- Неоднозначные и pending записи требуют ручной проверки отсутствия доставки.
  Успех API без успешного сохранения mapping не возвращается как sent.
- Источник текста/медиа остаётся в Telegram: восстановления используют copyMessage;
  payload и личные данные не добавлены в БД. Для восстановления private→forum
  sender label читается getChat только в памяти.
- 529b509: CLI обёрнуты в async main для production CommonJS/tsx; добавлена
  runtime-проверка их загрузки. При первом runtime smoke обнаружено:
  `Top-level await is currently not supported with the "cjs" output format`.

Dev bot и notification worker config не менялись. Миграций нет. Чужой локальный
неопубликованный Chronicle commit сохранён; работа выполнена в отдельном worktree
от origin/main. В remote main опубликован только Reception fix, с fast-forward.

## Проверки

- Targeted: 38 passed, три файла, включая 10 тестов на реальной изолированной
  PostgreSQL. Восемь конкурентных recovery-вызовов дают одну отправку; duplicate
  update остаётся duplicate; header reuse, ambiguity guard, retry_after, источник,
  configured target и сбой записи mapping проверены.
- Отдельный CLI runtime test: 1 passed; обе CLI действительно загружаются через
  node --import tsx и безопасно отказывают при отсутствии config/args.
- Полный Core suite: 916 passed / 168 skipped, 129 passed / 13 skipped файлов.
  После небольших дополнительных guards выполнены targeted и CLI проверки.
- Typecheck и локальный production build успешны; git diff --check успешен.
- Первый recovery integration run выявил потерю микросекунд timestamp при передаче
  JavaScript Date в CAS и конфликт source IDs в synthetic fixture. Исправлены
  точный строковый timestamp и изоляция fixture; повтор успешен.
- Тестовый HTTP/Telegram транспорт в integration tests — deterministic fake;
  реальные controlled-account доставки до восстановления egress не подтверждены.
- Изолированный PostgreSQL container, его том и тестовые схемы удалены.

## Восстановление сообщений и внешний блокер

Восстановленных исторических сообщений: 0. Failed-записи и их ID сохранены,
попытки вслепую не выполнялись. После восстановления сети сначала сверить
отсутствие соответствующих сообщений в обоих целевых чатах, затем восстановить
по одной записи согласно [процедуре](../reception-relay-recovery.md). Один прежний
Telegram 400 требует проверки источника/причины после восстановления Bot API.
Если оригинал удалён или Telegram отказывает в copyMessage, отправитель должен
прислать его заново; сейчас такая необходимость не установлена.

Требуемое внешнее действие: восстановить штатный исходящий HTTPS от production
host к api.telegram.org:443 у хостинга/сетевого администратора. Затем выполнить
getMe/getWebhookInfo/getChatMember и controlled tests с двумя аккаунтами в ОБОИХ
направлениях, подтвердить доставку людьми и DB status=sent. Пока это не сделано,
сервис нельзя объявлять восстановленным.

## Production после исправления

DEPLOYED_COMMIT: 529b5099522fd6367106cd0589225cf077c8cbcd

Повторный штатный update.sh завершился с exit 0; production build и TypeScript
успешны. SHA checkout совпал, новые CLI реально запущены в web container.
web/db healthy, worker/caddy работают. Главная HTTPS 200; POST Reception webhook
без secret header 401. CLI dry-run выполнен для private_to_forum timeout и
forum_to_private Telegram 400, оба apply=false, записей не менял.

Production getMe и getWebhookInfo, а также отдельный getChatMember по ID бота,
полученному в памяти из собственного token, завершились network_or_timeout.
Webhook URL, allowed_updates, pending updates у Telegram и текущие права не
подтверждены. Фактических контролируемых доставок в Telegram после исправления
нет; status=sent для новых реальных тестов не подтверждён.

Первый deploy уже завершился на сервере (update.sh отсутствовал среди процессов,
новый web healthy), но его SSH-процесс завис после завершения. Закрыто только
проверенное собственное SSH-соединение. Второй deploy выполнен тем же update.sh
с локальным серверным log file и подтверждённым exit 0. В prod инфраструктуру,
конфигурацию Dev bot/notification worker и credentials изменений не внесено.
