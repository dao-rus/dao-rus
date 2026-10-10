# Приёмная: API анкеты, этап 1

Архитектурное решение: [reception-miniapp-onboarding.md](../architecture/reception-miniapp-onboarding.md).

## Авторизация

Все методы `/api/reception/application` требуют заголовок
`Authorization: tma <Telegram.WebApp.initData>`. Не передавать initData в URL.
Сервер использует только `TELEGRAM_RECEPTION_BOT_TOKEN`; Dev bot, Core cookie и
пользовательские Telegram ID не дают доступа к этому API. Проверка переиспользует
существующий HMAC verifier: подпись, отсутствие повторяющихся ключей, проверенный
положительный Telegram ID, срок 600 секунд и допуск будущего времени 60 секунд.
После истечения срока UI должен предложить повторно открыть Mini App.
Проверка сверена с [документацией Telegram](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

Core-сессия, Participant, external identity и membership при подаче не создаются.
Токен, полное initData и Telegram-профиль не сохраняются и не логируются.
Ответы имеют `Cache-Control: no-store` и `Vary: Authorization`; прокси также не
должен записывать заголовок Authorization в access logs.

## Контракт

- `GET`: `{ "application": null }`, если анкеты нет, иначе собственная анкета.
- `POST`: первая подача — 201, повторная подача/исправление — 200, одна постоянная
  заявка на Telegram ID. Повтор с теми же сведениями сохраняет revision и даты.
- `PUT`: полная замена сведений своей анкеты; 404, если она ещё не подана.

POST/PUT принимают только JSON с полями:

```json
{
  "city": "Тверь",
  "occupation": "Мастер",
  "age": 35,
  "publishAge": false
}
```

`city` и `occupation` — обязательный свободный текст без управляющих символов,
после trim от 1 до 200 и от 1 до 1000 Unicode-символов соответственно.
`age` — необязательное целое 1–120; отсутствие или null очищает возраст.
`publishAge` — обязательный boolean, true допустим только при указанном возрасте.
Знание возраста само по себе не является согласием на публикацию. Чтобы удалить
возраст, передать `age: null, publishAge: false`.
Неизвестные поля и query-параметры отклоняются; выбор чужого ID отсутствует.
Максимум JSON body — 8000 символов.

Ответ содержит `application`: `id`, сведения анкеты, `status`, `revision`,
`createdAt`, `updatedAt`, независимые `publicationStatus`, `publishedRevision`,
`invitationStatus`. Возраст доступен только владельцу через этот API; публичного
или административного чтения на этапе 1 нет. Внутренние identity links, Telegram
ID, quota и диагностика доставки не выдаются.

Ошибки: 400 `invalid_form`/`invalid_request`, 401 `unauthorized`, 404 `not_found`,
409 `identity_conflict`, 429 `rate_limit` с `Retry-After: 60`,
503 `reception_unavailable`. Лимит — 10 успешных POST/PUT за минутное окно на
Telegram ID, включая идентичные повторы; GET не расходует лимит.

## Хранение и инварианты

Миграция `052_reception_applications.sql` добавляет:

- `reception_applications`: уникальный Telegram ID, nullable Participant FK,
  сведения, согласие, состояние submitted/deferred/closed, revision и счётчик
  записи. Не копирует и не меняет членство.
- `reception_application_deliveries`: стабильная операция на пару заявка/тип
  (publication либо invitation), собственное состояние, message/chat ID,
  delivered_revision, attempts/retry_at и технический error_code.

При первой подаче заявка и publication/pending записываются атомарно. Отсутствие
invitation означает not_requested. В этапе 1 нет отправителя и нет операции,
которая создаёт invitation. Никаких Telegram API calls из этого потока нет.
Уникальные ограничения и транзакционная advisory lock защищают конкурентную
подачу, правки и лимит между экземплярами Core.

Participant разрешается существующим read-only `inspectTelegramParticipantById`
по Telegram ID (external identity и roster), с проверкой существующего miniapp
subject. При противоречии возвращается
409 без записи. Имя, bio, residence, Telegram identity и членство не обновляются.
Если identity создана позднее, связь уточняется при следующей записи анкеты;
автоматическое связывание после вступления относится к этапу 5.

Правки повышают revision, но не сбрасывают delivered/needs_review и не создают
повторную публикацию. Будущий отправитель должен фиксировать доставленную revision,
проверять publishAge непосредственно при подготовке публикации и явно согласовать
обновление уже опубликованного сообщения, включая отзыв согласия на возраст.
error_code предназначен для короткого безопасного кода, не для сырых ошибок/секретов.

## Проверка и продолжение

PostgreSQL tests требуют `RECEPTION_TEST_DATABASE_URL` с host `127.0.0.1` и БД
`reception_tests`. Они применяют все миграции в случайной схеме, проверяют
сохранность Participant при новой миграции, реальные конкурентные запросы,
rollback, доступ, identity и ограничения БД, затем удаляют свою схему.

```powershell
npm test -- src/lib/reception-applications.test.ts src/lib/reception-applications.integration.test.ts src/lib/telegram-mini-app.test.ts src/app/api/auth/telegram/mini-app/route.test.ts
npm run typecheck
npm run build
```

Этап 2: UI анкеты, предпросмотр города/занятий и отдельное согласие на публикацию
возраста, чтение/исправление, кнопка запуска Mini App в Reception bot. До этапа 3
UI должен говорить только о сохранении и ожидающей доставке. Publication worker,
журнал Хранителя, приглашение и согласование прежнего auto-invite остаются этапами
3–4; связывание/перенос данных после вступления — этапом 5. Старые webhook, relay,
Dev Mini App auth и механизм приглашений на этапе 1 не меняются.
