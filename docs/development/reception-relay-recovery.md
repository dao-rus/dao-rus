# Диагностика и восстановление Приёмной

Приёмная использует собственный bot token, webhook secret и таблицу
`reception_relay_updates`. Dev bot и notification worker не являются транспортом
Приёмной. Webhook и исходящий Bot API проверяются раздельно: HTTP 200 webhook не
доказывает доставку в Telegram.

## Диагностика

В production web container:

```sh
sudo -n docker exec dao-core-web-1 node --import tsx scripts/reception-diagnostics.ts
```

Команда делает только getMe, getWebhookInfo и getChatMember. Выводит наличие
конфигурации без token/secret, URL webhook без query, allowed_updates, очередь и
последнюю ошибку, идентичность бота и права в форуме. Если HTTPS недоступен на самом
host, сначала восстановить штатную сетевую связность с api.telegram.org:443;
не сбрасывать webhook, не менять credentials и не подключать обходной транспорт.
General topic 1 требует отсутствия message_thread_id при отправке. Проверить
реальную отправку в topic можно только контролируемым тестом.

```sql
SELECT direction,status,coalesce(error_code,'none'),count(*)
FROM reception_relay_updates WHERE created_at>=now()-interval '72 hours'
GROUP BY 1,2,3 ORDER BY 1,2,3;
```

Логи `reception_relay_failed` содержат update ID, направление, безопасный errorCode
и требуемое действие. Произвольные Telegram description, тексты, имена, chat IDs
и secrets не логируются. Код ошибки сохраняет известную причину, например
parse_entities, topic_not_found, posting_forbidden, bot_blocked, source_not_found,
и retry_after при 429. Ошибки без подтверждённого отказа API неоднозначны.

## Восстановление одной записи

Telegram хранит исходный текст/медиа. Core хранит только routing/message IDs;
таблицу не удалять и update ID не переиспользовать. Payload личной переписки не
нужен для восстановления через copyMessage. Уже отправленный заголовок сохраняется
до copyMessage и используется повторно при восстановлении. Для нового заголовка
CLI получает актуальное имя исходного private sender через getChat; данные не
пишутся в БД или диагностический вывод.

Просмотр выбранной записи (без отправки):

```sh
sudo -n docker exec dao-core-web-1 node --import tsx scripts/reception-recovery.ts --update UPDATE_ID
```

Для подтверждённого отказа Telegram 400/401/403/404/429 после устранения причины:

```sh
sudo -n docker exec dao-core-web-1 node --import tsx scripts/reception-recovery.ts --update UPDATE_ID --apply
```

Таймаут, network error, invalid response, Telegram 5xx и pending **никогда не
повторяются автоматически**. Сначала человек проверяет отсутствие доставки в
целевом чате/ветке и отсутствие работающего процесса доставки. Только после такой
проверки допускается явный запуск:

```sh
sudo -n docker exec dao-core-web-1 node --import tsx scripts/reception-recovery.ts --update UPDATE_ID --apply --confirmed-not-delivered
```

Ожидание само по себе не подтверждает отсутствие доставки. Команда защищена CAS по
status/error_code/updated_at (timestamp передаётся как строка PostgreSQL, без потери микросекунд в JS Date), так что параллельные операторы не отправляют повторно
одну запись. Активная попытка моложе 15 секунд и неистёкший retry_after блокируются.
После реального успеха API сохраняются message IDs и status=sent; повтор webhook
по тому же update ID остаётся duplicate. Сбой после успеха Telegram, но до записи
в БД оставляет неоднозначный pending и требует сверки в Telegram.

Если доставка уже есть, повторно её не отправлять: сверить ID сообщения и вручную
восстановить mapping в проверенной узкой транзакции. Если Telegram больше не может
скопировать оригинал (source_not_found/source_not_copyable) или нет исходного ID,
отправитель должен прислать сообщение заново. status=sent вручную без проверки
существующего сообщения не ставить.

## Контрольный тест

Два выбранных владельцем тестовых аккаунта пишут в @Daorus_bot. Сверить фактические
копии в Приёмной и две записи private_to_forum status=sent. Ответить именно на эти
копии/их заголовки из форума; подтвердить получение обоими аккаунтами и две записи
forum_to_private status=sent. Проверка API/DB без подтверждения людей не доказывает
доставку через обе реальные Telegram поверхности.
