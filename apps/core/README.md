# DAO Rus Core — prototype 0.1

Первый вертикальный срез цифрового ядра ДАО Русь.

Цель этой версии предельно узкая:

**Telegram identity → внутренний Participant → PostgreSQL → `/profile` → журнал событий.**

Архитектурный контекст проекта находится выше по репозиторию:

- `../../docs/ontology/ontology.md`
- `../../docs/architecture/dao-core-v0.1.md`
- `../../legacy/tg-oauth-bridge/` — только историческая справка; новый Core от него не зависит.

## Что уже реализовано

- собственный UUID участника, независимый от Telegram ID;
- связь участника с внешней Telegram identity;
- PostgreSQL как source of truth;
- события `participant.created` и `participant.logged_in`;
- серверные сессии с непрозрачным токеном в HttpOnly cookie;
- Telegram OpenID Connect Authorization Code Flow + PKCE;
- серверная проверка Telegram ID token через JWKS;
- профиль `/profile`;
- общее верхнее меню авторизованных страниц с переходами на главную, вече,
  «Нужно / есть», сеть, свой профиль и Кодекс; названия меню читаются из
  `interfaceTextFields` и доступны для редактирования в `/admin/interface`;
- изменение `display_name` текущим авторизованным участником;
- страница `/profile/activity` со статистикой за 7 и 30 дней и последними событиями;
- создание простых предложений и список `/veche`;
- приём сообщений одного разрешённого Telegram-чата через защищённый webhook;
- одноразовый импорт Telegram roster snapshot и отдельный импорт исторического состава основного форума в нейтральные Core Participants;
- защищённый прототипный Participant Registry для ручной классификации roster;
- заглушки для трёх будущих профилей репутации: активность, отзывы, коммуникабельность;
- локальный demo-login, чтобы проверить прототип до настройки BotFather;
- SQL migrations;
- базовые тесты логики create/reuse identity.

## Что намеренно НЕ реализовано

- формулы репутации;
- редакции предложений и решения;
- вече и голосования;
- проекты;
- команды и ответы Telegram-бота;
- AI;
- миграция пользователей Discourse.

## 1. Самый простой локальный запуск: Docker Compose

Нужен Docker Desktop.

В PowerShell из `apps/core`:

```powershell
Copy-Item .env.example .env

docker compose up --build
```

При первом старте контейнер автоматически применит migrations.

Открой:

`http://localhost:3000`

Пока Telegram не настроен, нажми **«Демо-вход для локальной проверки»**. Он работает только при `DEV_AUTH_BYPASS=true` и автоматически отключается при `NODE_ENV=production`.

Остановить:

```powershell
docker compose down
```

Удалить также локальную БД прототипа:

```powershell
docker compose down -v
```

Последнюю команду не выполнять, если данные уже нужны.

## 2. Запуск Next.js локально, PostgreSQL в Docker

Подними только БД:

```powershell
docker compose up -d db
```

Затем:

```powershell
Copy-Item .env.example .env
npm install
npm run db:migrate
npm run dev
```

В `.env` `DATABASE_URL` уже указывает на `localhost:5432`, поэтому такой режим работает без изменения строки подключения.

## 3. Проверки

```powershell
npm test
npm run typecheck
npm run build
```

## 4. Настройка настоящего Telegram Login

Telegram использует стандартный OIDC Authorization Code Flow со scope `openid profile telegram:bot_access`, PKCE S256 и серверной проверкой ID token. Номер телефона не запрашивается; уже сохранённый телефон остаётся необязательным полем профиля.

В BotFather для бота, представляющего DAO Rus:

1. Открой настройки **Login Widget**.
2. Зарегистрируй Allowed URL сайта.
3. Зарегистрируй точный callback URL, например:
   `https://core.daorus.org/api/auth/telegram/callback`
4. Получи Client ID и Client Secret.
5. Оставь алгоритм подписи ID token по умолчанию **RS256**.

Заполни на сервере (не в Git):

```env
APP_BASE_URL=https://core.daorus.org
TELEGRAM_OIDC_CLIENT_ID=...
TELEGRAM_OIDC_CLIENT_SECRET=...
TELEGRAM_OIDC_REDIRECT_URI=https://core.daorus.org/api/auth/telegram/callback
TELEGRAM_BOT_TOKEN=...
DEV_AUTH_BYPASS=false
```

`TELEGRAM_OIDC_CLIENT_SECRET` и `TELEGRAM_BOT_TOKEN` никогда не должны попадать в браузер, Telegram Mini App, Git или логи. Bot API token должен принадлежать боту с `TELEGRAM_OIDC_CLIENT_ID`; без него OIDC login работает, но дополнение профиля через Bot API недоступно.

После каждого успешного OIDC login Core обновляет отдельную Telegram identity: сохранённые OIDC claims и доступные поля `getChat`, текущего фото `getUserProfilePhotos` и аудио профиля `getUserProfileAudios`. Запросы к Bot API best-effort; отсутствующие optional-поля не удаляют прежние значения. Имя, выбранное в Core, не перезаписывается. Телефон доступен только владельцу на `/profile`; каталог и чужой профиль его не выбирают. Фото хранится как `file_id` и метаданные, без копии файла: авторизованный маршрут получает `getFile` URL заново и отдаёт только фото известного вошедшего Participant, не раскрывая токен. Telegram гарантирует ссылку `getFile` лишь на один час, поэтому её нельзя сохранять как публичный URL.

После изменения `.env` пересоздай контейнер `web`, чтобы Docker Compose передал ему новые значения:

```powershell
docker compose up -d --force-recreate web
```

Для реального Telegram OIDC локальный `localhost` может быть неудобен из-за Allowed URLs. Практический путь — тестовый HTTPS-домен/туннель, зарегистрированный в BotFather.

При тестировании через туннель открывай приложение и начинай Telegram login с того же публичного HTTPS origin, который указан в `APP_BASE_URL`. Если начать flow с `localhost`, host-only cookies с `state` и PKCE verifier останутся на `localhost`, и callback на домене туннеля их не получит.

### Вход «Мне нужно» из @DAORusDev_bot

Постоянная кнопка меню в личном чате бота открывает https://core.daorus.org/need.
Текст кнопки — «Мне нужно». Telegram поддерживает такую кнопку через
setChatMenuButton или настройку Menu Button в BotFather. Это кнопка в чате
с ботом, а не глобальная кнопка во всех чатах Telegram.

На /need вошедший участник сразу вводит текст. Если сессии Core нет, экран
предлагает существующий Telegram OIDC login и после него возвращает на /need.
Сохранение вызывает существующий addProfileSignal с kind=need, а запись
появляется в обычном /profile. Видимость выбирается явно; исходное значение
members совпадает с формой профиля. match_only пока лишь хранит запись для
будущего сопоставления и не создаёт match.

Кнопку нужно назначать после публикации маршрута /need. Используй токен
того же бота, что указан в TELEGRAM_OIDC_CLIENT_ID, и проверь текущую кнопку
через getChatMenuButton до изменения. Параметры setChatMenuButton для кнопки
по умолчанию: menu_button={"type":"web_app","text":"Мне нужно",
"web_app":{"url":"https://core.daorus.org/need"}}. Токен не выводить в лог
и не сохранять в репозитории. После назначения проверь getChatMenuButton
и открытие кнопки в личном чате @DAORusDev_bot.

## «Приёмная»: relay и первый срез Хранителя

Это отдельный адаптер «Приёмной» к уже существующим `participants` и
`external_identities`. Состояние шага хранится в
`participant_forum_onboarding`, а переходы — в `events`. Оно не меняет
`participants.membership_status`, Human Verification или репутацию. Старый
`telegram_roster_entries.membership_status` не является показателем членства в
форуме: это административная классификация, поэтому для конкретного Telegram
user ID используется Bot API `getChatMember`.

Для работы нужны **проверенные оператором** значения в серверной конфигурации:

```env
TELEGRAM_RECEPTION_BOT_TOKEN=
TELEGRAM_RECEPTION_WEBHOOK_SECRET=
TELEGRAM_RECEPTION_BOT_USERNAME=
TELEGRAM_FORUM_CHAT_ID=
TELEGRAM_RECEPTION_TOPIC_ID=
TELEGRAM_FORUM_INVITE_URL=
TELEGRAM_GUARDIAN_INVITES_ENABLED=false
```

Access log Caddy не содержит request headers.

Персональные уведомления хранятся в Core (`notifications`), а их Telegram-
доставка учитывается отдельно (`notification_deliveries`). Compose запускает
`notification-worker` из того же production image. По умолчанию
`TELEGRAM_NOTIFICATIONS_ENABLED=false`: worker не забирает `pending` и ничего
не отправляет. При включении он использует только `TELEGRAM_BOT_TOKEN` бота
DAO RUS Dev, последовательно обрабатывает `pending` и не повторяет отправку
после `unknown`. Запись, оставшаяся в `processing` более 10 минут, получает
`unknown` без нового обращения к Telegram. Логи содержат только delivery ID,
статус и безопасный код ошибки; текст уведомления и Telegram user ID не пишутся.

Токен должен принадлежать именно «Приёмной», а `TELEGRAM_FORUM_CHAT_ID` —
основному forum supergroup. Установите «Приёмную» администратором форума:
`getChatMember` для других пользователей гарантирован только администратору.
Проверьте права и ответ метода на тестовом участнике до включения рассылки.
`TELEGRAM_FORUM_INVITE_URL` — действующая ссылка, которую оператор разрешил
показывать зарегистрированным пользователям Core. Core не создаёт и не меняет
invite link. Username нужен для ссылки из профиля на личный чат «Приёмной».

`TELEGRAM_RECEPTION_TOPIC_ID` — numeric `message_thread_id` существующей темы
«Приёмная». Relay копирует личные сообщения в эту тему через `copyMessage` и
передаёт ответ человеку только при reply на сообщение с сохранённым mapping
из точно указанного форума и темы. Поддержаны текст, фото, видео, документы,
аудио, voice/video notes, анимация, стикеры, контакты и геолокация.
Если «Приёмная» является общей темой форума (ID `1`), Bot API требует не
передавать `message_thread_id` при отправке в неё; входящие ответы в этой теме
определяются по отсутствию `is_topic_message=true` и сохранённому mapping.
Core не сохраняет содержимое: `reception_relay_updates` хранит ID update,
private chat/message, forum message, направление, состояние и код ошибки.
Таблица отдельна от `telegram_processed_updates` другого бота: их update ID
могут совпасть. Обращение человека без профиля Core не создаёт Participant.
Повторный update не вызывает повторной отправки. Ошибки доставки и
неподдерживаемые типы получают статусы `failed` и `unsupported`.
Неопределённую отправку Core автоматически не повторяет во избежание дубля.
Старые сообщения Livegram остаются в Telegram без старого mapping в Core.

Вход через Telegram OIDC или Mini App запускает проверку членства после
создания Core session. Ошибка Bot API не блокирует вход. Если человек не в
форуме, Core фиксирует `onboarding.forum_incomplete`. Личное приглашение
отправляется только при `TELEGRAM_GUARDIAN_INVITES_ENABLED=true` и наличии
invite URL; один лишь token рассылку не включает. Если Telegram не разрешает писать человеку,
повторная попытка возможна только после его `/start` в личном чате «Приёмной».
При неопределённом результате отправки повторная попытка автоматически не
делается, чтобы не прислать два сообщения. Это гарантия не более одной
потенциально доставленной попытки, а не гарантия доставки.

Для событий вступления настройте webhook именно бота «Приёмная ДАО Русь» на
`${APP_BASE_URL}/api/telegram/reception/webhook` с
`TELEGRAM_RECEPTION_WEBHOOK_SECRET` как `secret_token` и
`allowed_updates=["message","chat_member"]`. `chat_member` требует прав
администратора и явной подписки. Endpoint принимает личные сообщения, replies
из темы «Приёмная» и изменения членства основного форума. Данные неизвестного
Core посетителя используются только для маршрутизации обращения. Перед `setWebhook` проверьте текущий
`getWebhookInfo`: Telegram допускает один webhook на бота. Если существующая
«Приёмная» уже обслуживает заявки через другой endpoint, сначала обеспечьте
доставку этих двух типов update в Core из существующего обработчика или
объедините обработчики; простая замена webhook до готовности Core прервёт старый
сценарий. Локальная разработка не переключает Livegram webhook.

Подтверждённый переход `chat_member` из `left`/`kicked`/не состоящего в форуме
`restricted` в состояние члена форума создаёт при необходимости нейтрального
Participant (`membership_status='none'`) и Telegram identity по user ID. Создание
identity и запись `forum_joined` происходят в одной транзакции; конфликт связей
с roster или другой identity прерывает её без объединения профилей. Имя и username
из того же update записываются в пустые поля identity и заменяют заглушку «Участник форума»:
вступивший виден участникам форума под этим именем. Данные входа и имя, выбранное в Core,
не перезаписываются. Личное
сообщение боту и проверка `getChatMember` Participant не создают. Для импорта
исторического roster предназначена та же функция поиска/создания по Telegram ID.

После будущего переключения webhook проверить новое личное сообщение боту,
его появление в точной теме «Приёмная» и ответ reply из этой темы обратно в
личный чат. Также проверить, что пост в другой теме не пересылается. Для
Хранителя: зарегистрировать Telegram-пользователя в Core, проверить отсутствие
в форуме через `getChatMember`, включить flag приглашений только после проверки
доставки, затем проверить одну запись `onboarding.forum_invitation_sent`.
После вступления проверить `participant_forum_onboarding.forum_status = 'joined'`
и событие `onboarding.forum_joined`; повторный вход не должен отправить новое
приглашение. Членство в форуме не влияет на доступ к Core.


## 5. Лабораторное подключение Telegram Ingestion v0.1

Поток данных:

`Telegram → HTTPS tunnel → /api/telegram/webhook → telegram.message_created → PostgreSQL`

DAO Core принимает только Bot API updates типа `message` из одного chat ID. Запрос защищён Telegram-заголовком `X-Telegram-Bot-Api-Secret-Token`; сообщения других чатов подтверждаются, но не сохраняются.

После проверки chat ID Core ищет отправителя в `external_identities` по Telegram user ID. Событие создаётся только для уже известного Participant. Сообщение неизвестного Telegram user получает `200 OK`, но его update ID, Telegram user ID, username, текст и другая история не сохраняются. Первый последующий вход такого человека через Telegram OIDC считается активацией профиля в DAO Core, а не повторным вступлением в ДАО.

`message_thread_id` сохраняется независимо и сам по себе не означает Forum Topic: Telegram может прислать его и для обычного message thread. Для различения используются отдельные поля `is_topic_message` и `chat_is_forum`; отсутствие этих optional-признаков в update нормализуется в `false`.

### Подготовка бота и чата

1. Создай отдельного лабораторного бота через BotFather или используй уже созданного бота DAO Rus.
2. Добавь бота в нужную группу/forum.
3. Чтобы бот получал обычные сообщения, сделай его администратором либо отключи Privacy Mode через `/setprivacy`. После отключения Privacy Mode удали и заново добавь бота в группу.
4. До установки webhook отправь в группу сообщение или команду боту и узнай numeric chat ID через `getUpdates`:

```powershell
$botToken = Read-Host "Telegram Bot Token"
(Invoke-RestMethod "https://api.telegram.org/bot$botToken/getUpdates").result |
  ForEach-Object { $_.message.chat.id } |
  Where-Object { $_ } |
  Select-Object -Unique
```

Bot Token нужен только оператору для вызовов Bot API. DAO Core не использует его при приёме webhook, поэтому не добавляй token в `.env`, код или Git.

### Конфигурация DAO Core

Создай случайный secret из разрешённых Telegram символов и заполни серверный `.env`:

```env
APP_BASE_URL=https://your-tunnel.trycloudflare.com
TELEGRAM_WEBHOOK_SECRET=replace-with-a-random-secret
TELEGRAM_INGEST_CHAT_ID=-1001234567890
```

Secret должен содержать 1–256 символов из `A-Z`, `a-z`, `0-9`, `_` и `-`. После изменения `.env` пересоздай `web`; при старте автоматически применится migration:

```powershell
docker compose up -d --force-recreate web
```

### Регистрация webhook

Точный endpoint всегда равен `${APP_BASE_URL}/api/telegram/webhook`. Для tunnel из примера это:

`https://your-tunnel.trycloudflare.com/api/telegram/webhook`

Зарегистрируй webhook, передав тот же secret, который находится в `.env`, и ограничь Telegram updates типом `message`:

```powershell
$webhookUrl = "https://your-tunnel.trycloudflare.com/api/telegram/webhook"
$webhookSecret = Read-Host "TELEGRAM_WEBHOOK_SECRET"

Invoke-RestMethod -Method Post `
  -Uri "https://api.telegram.org/bot$botToken/setWebhook" `
  -Body @{
    url = $webhookUrl
    secret_token = $webhookSecret
    allowed_updates = '["message"]'
  }

Remove-Variable botToken, webhookSecret
```

Quick Tunnel получает новый hostname после перезапуска. При его изменении обнови `APP_BASE_URL`, пересоздай `web` и повторно вызови `setWebhook` с новым URL.

### Проверка PostgreSQL

После сообщения в разрешённой группе:

```powershell
docker compose exec db psql -U dao -d dao -c "SELECT id, event_type, participant_id, payload, created_at FROM events WHERE event_type = 'telegram.message_created' ORDER BY id DESC LIMIT 10;"
```

Повторная доставка того же `update_id` не должна добавлять вторую строку события.

## Production deployment на отдельный VPS

Production-контур отделён от локального `docker-compose.yml` и запускается через
`compose.prod.yml`:

`Internet → Caddy :80/:443 → Next.js web:3000 → PostgreSQL:5432`

Наружу публикуются только порты Caddy. `web` доступен Caddy по Docker network
`proxy`, а PostgreSQL находится только во внутренней сети `backend`. Перед запуском
web одноразовый сервис `migrate` выполняет существующий `npm run db:migrate`; при
ошибке integrity check или migration приложение не запускается.

На чистом Ubuntu VPS сначала запусти `deploy/bootstrap.sh`. Скрипт устанавливает
Docker Engine с Compose plugin, создаёт swap `/swapfile` размером 2 GiB, включает
UFW для SSH/HTTP/HTTPS и подготавливает `/opt/dao-rus`.

Production secrets хранятся только в `apps/core/.env.production` на VPS. Файл
игнорируется Git и Docker build context. Начни с `.env.production.example`, задай
URL-safe пароль PostgreSQL и Telegram credentials, затем ограничь права:

```bash
chmod 600 apps/core/.env.production
```

Для первого и последующих обновлений из Git используется:

```bash
sudo DAO_CORE_REPO_DIR=/opt/dao-rus DAO_CORE_BRANCH=main \
  bash /opt/dao-rus/apps/core/deploy/update.sh
```

Caddy автоматически получает и обновляет TLS-сертификат, когда DNS A record
`core.daorus.org` указывает на VPS и внешние TCP-порты 80/443 доступны. UDP 443
публикуется для HTTP/3.

### Тексты главной страницы

Администратор из существующего `ADMIN_PARTICIPANT_IDS` может редактировать тексты
главной страницы, заголовок `/participants` и надпись над именем на `/profile`
через `/admin/interface`. Это фиксированный список ключей,
а не произвольные страницы или HTML. Значения хранятся в `ui_text_overrides`;
отсутствие записи означает default из кода. Отдельное поле можно вернуть к
default галочкой в форме. Только фактическое изменение override создаёт
`interface.texts_updated` с UUID администратора и списком изменённых ключей,
без содержимого текстов в событии.

`ActionPill` (`src/components/action-pill.tsx`) — презентационная ссылка для
призывов к действию: получает `href` и содержимое от вызывающей страницы.
Авторизованный участник видит невыполненные first-action quests из доменного
слоя `onboarding-quests.ts`. Тексты пользы действий и заголовок блока Кодекса
входят в реестр `interfaceTextFields`; суммы берутся из `reward_rules`.

### Onboarding first actions

Источники `residence_first_filled`, `interest_first_added`, `need_first_created`,
`have_first_created` используют существующий append-only `darus_ledger`.
`onboarding_quest_completions` хранит постоянный факт первого действия, независимо
от удаления города/интереса или архивирования сигнала. Уникальные ограничения
защищают факт и ledger от повторного начисления, включая конкурентные записи.
Триггеры PostgreSQL сохраняют completion, reward и audit в транзакции самого
действия, одинаково для Web и других адаптеров. Отключённое правило не выдаёт
награду, но выполненное действие всё равно навсегда завершает quest.

Миграция 026 завершает прежние действия по событиям, ledger и сохранившимся
записям без ретроактивного начисления. Старые residence-события не содержат
заполненного значения: они консервативно закрывают quest, но сами по себе не
доказывают право на переходную награду. Изменения БД вручную с удалением всей
истории не могут быть восстановлены из текущего состояния.

Переходное обещание релиза `c926a20` учитывается отдельно: начало окна —
`2026-10-02T10:42:19.468435061Z`, подтверждённое время запуска production web.
Конец фиксируется миграцией 026 под блокировками существующих writers. Первое
из четырёх подходящих действий в окне даёт одну суммарную награду 0.1 DARUS
через `onboarding_promise_reconciled`; residence reward, уже полученный в этом
окне, удовлетворяет обещание. Действия до начала окна исключены.

Read-only dry-run без персональных данных:
`npx tsx scripts/onboarding-reconciliation.ts` (или `--sql` для выполнения
через штатный production SSH/psql). Apply выполняется только миграцией 026;
повторный deploy не повторяет начисления. Итог хранится в ledger и audit events,
границы окна — в append-only `onboarding_reconciliation_runs`.

Реальные транзакционные/конкурентные тесты запускаются с отдельным
`ONBOARDING_TEST_DATABASE_URL` на локальную БД `onboarding_tests`. Тесты не
используют production `DATABASE_URL`; без изолированной БД они пропускаются.

## 6. Одноразовый Telegram Roster v0.1

Обычный `telegram:roster:import` ниже сохраняет технический roster без создания
Participant. Для однократного переноса исторического состава основного форума
используйте отдельный `telegram:forum:import` в конце этого раздела. Имя из
MTProto roster не переносится в публичный `participants.display_name`:
автоматически созданный профиль получает временное имя до получения актуального
имени через Bot API или входа участника в Core.

Bot API не предоставляет надёжный полный список участников закрытого supergroup/forum. Для лабораторного snapshot используется отдельный локальный MTProto-клиент под пользовательским Telegram-аккаунтом. Официальные точки отсчёта: [получение `api_id`/`api_hash`](https://core.telegram.org/api/obtaining_api_id), [авторизация пользователя](https://core.telegram.org/api/auth) и [`channels.getParticipants`](https://core.telegram.org/method/channels.getParticipants).

Пользовательский аккаунт должен уже состоять в нужном чате. Telegram может также потребовать admin-права для чтения полного roster. Экспорт выполняется однократно и не является постоянно работающей интеграцией.

### Локальный экспорт JSON

Исторический архив убытия `@list_of_exites`: отдельный [export → dry-run → reviewed apply](../../docs/development/telegram-departure-archive.md).
Первый запуск не записывает данные в Core; скриншоты и отчёты остаются локально.

1. Создай Telegram API application на [my.telegram.org](https://my.telegram.org) и получи собственные `api_id` и `api_hash`.
2. Установи локальный Python helper в игнорируемое окружение:

```powershell
cd apps/core
python -m venv .local/telegram-venv
& .\.local\telegram-venv\Scripts\python.exe -m pip install -r tools/telegram/requirements.txt
```

3. Запусти exporter, указав numeric chat ID или публичный `@username`:

```powershell
& .\.local\telegram-venv\Scripts\python.exe tools/telegram/export_roster.py --chat -1001234567890
```

При первом запуске helper безопасно запросит `api_id`, `api_hash`, номер аккаунта, login code и при необходимости 2FA password. Не передавай эти значения аргументами командной строки и не добавляй их в `.env`: они не являются runtime-конфигурацией DAO Core.

Session и JSON snapshot создаются в `apps/core/.local/telegram/`, который исключён из Git. Session-файл даёт доступ от имени пользовательского аккаунта: не пересылай его, после завершения импорта удали локально или отзови соответствующую сессию в Telegram Devices.

Snapshot содержит только:

- `telegram_user_id` в виде точной decimal string;
- `username`;
- `display_name`;
- `is_bot`;
- доступный Telegram `UserStatus`, нормализованный в `online`, `exact`,
  `recently`, `last_week`, `last_month` или `unknown`;
- точный `telegram_last_seen_at` только для `UserStatusOffline.was_online`;
- единый `observed_at` и `telegram_presence_observed_at` для снимка.

`UserStatusOnline` сохраняется как `online`; `UserStatusOffline.was_online` — как
`exact` с фактическим timestamp; privacy-категории `UserStatusRecently`,
`UserStatusLastWeek` и `UserStatusLastMonth` сохраняются без придуманной даты.
Отсутствующий или неизвестный status становится `unknown`, что означает только
отсутствие доступной информации.

Exporter не читает сообщения и не сохраняет телефонные номера.

### Импорт в локальный DAO Core

Примени migration и выбери последний snapshot:

```powershell
docker compose exec web npm run db:migrate
$snapshot = (Get-ChildItem .local/telegram/telegram-roster-*.json |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1).Name
docker compose exec web npm run telegram:roster:import -- "/app/.local/telegram/$snapshot"
```

Импорт валидирует snapshot до подключения к PostgreSQL и выполняет весь upsert одной транзакцией. Конфликт разрешается по `telegram_user_id`. Повторный импорт обновляет roster-поля по более новому `observed_at`, а presence — отдельно только по более новому `telegram_presence_observed_at`; старый snapshot не может перезаписать более новое наблюдение.

Если для Telegram user ID уже существует `external_identities` с `provider = 'telegram'`, импорт заполняет `participant_id` соответствующим UUID. Для неизвестного Telegram ID поле остаётся `NULL`. Обратный порядок тоже поддерживается: успешный Telegram OIDC login связывает ранее импортированную roster entry с появившимся Participant.

Автоматическое связывание заполняет только пустой `participant_id` и никогда не меняет `identity_verification`. Если roster entry уже указывает на другого Participant, операция завершается integrity-ошибкой и транзакция откатывается; противоречащая связь не перезаписывается.

Новая запись получает `identity_verification = 'unverified'`. Roster не создаёт `Participant` или `ExternalIdentity`, не доказывает членство, не импортирует сообщения/телефоны и не формирует репутацию. `identity_verification` означает отдельную человеческую проверку личности внутри ДАО и не является результатом Telegram OIDC/Core login.

### Однократный перенос состава основного форума в Core

Сначала создайте свежий snapshot через тот же Telethon exporter. Его `chat.id`
должен соответствовать `TELEGRAM_FORUM_CHAT_ID`; другой чат importer отвергает.
Для dry-run нужен доступ Core к PostgreSQL, но SQL-транзакция открывается как
`READ ONLY`: выводятся только количества аккаунтов, ботов, уже связанных
Participant, новых Participant и конфликтов, без Telegram ID и имён.

```powershell
cd apps/core
npm run telegram:forum:import -- .local/telegram/telegram-roster-YYYYMMDDTHHMMSSZ.json --dry-run
```

Для будущего запуска в production после отдельного разрешения сначала
разверните версию Core с этой командой, перенесите **только JSON snapshot** в
защищённый файл на сервере вне Git и смонтируйте его в одноразовый контейнер.
MTProto credentials и session на production не переносятся. Запустите
`--dry-run` на том же файле, проверьте счётчики, затем явный `--apply`:

```bash
cd /opt/dao-rus/apps/core
sudo docker compose --env-file .env.production -f compose.prod.yml run --rm --no-deps \
  -v /secure/path/telegram-roster.json:/snapshot.json:ro web \
  npm run telegram:forum:import -- /snapshot.json --dry-run
sudo docker compose --env-file .env.production -f compose.prod.yml run --rm --no-deps \
  -v /secure/path/telegram-roster.json:/snapshot.json:ro web \
  npm run telegram:forum:import -- /snapshot.json --apply
```

`--apply` требует snapshot не старше 24 часов и ноль конфликтов. Он пропускает
ботов, в одной транзакции обновляет roster, находит или создаёт нейтрального
Participant (`membership_status='none'`), связывает Telegram identity и фиксирует
`forum_status='joined'` с событием `onboarding.forum_joined`. Более новое
наблюдение `absent` не перезаписывается старым snapshot. Повторный запуск не
создаёт новых Participant и не повторяет событие `forum_joined`. Конфликт
identity откатывает всю транзакцию без объединения профилей. Human Verification,
принятие Кодекса, репутация и специальные права не создаются. Удалите серверную
копию JSON после проверки результата; старая история Telegram не читается.

При Membership Binding roster-имя может временно стать `participants.display_name`,
но публичный каталог `/participants` показывает профиль только после собственного
успешного входа человека в Core (`participant.logged_in`). Прямой пользовательский
профиль до этого входа не показывает roster-имя. OIDC-вход обновляет имя из
Telegram, пока человек сам не выбрал имя в Core; такой выбор имеет приоритет и
помечается даже при сохранении прежнего значения. Миграция 010 восстанавливает
этот признак из прежних событий `participant.profile_updated` и заменяет
унаследованные имена у уже входивших людей доступными полями Telegram identity.
Roster-имя остаётся только fallback, когда других данных об имени нет.

Место жительства в профиле Core заполняет только сам участник: название и тип
населённого пункта, страна. Поле необязательно: при пустом названии место не
сохраняется, даже если в форме выбраны тип и страна по умолчанию. Его видят
только авторизованные участники Core. Переход по
месту жительства открывает `/participants` с точным совпадением всех трёх
значений без учёта регистра и лишних пробелов; каталог по-прежнему исключает
людей без собственного успешного входа. Эти данные не берутся из Telegram или
roster и не влияют на membership либо Human Verification.

### Human Verification v0.1

Каноническая человеческая верификация Core хранится отдельно от legacy-поля
`telegram_roster_entries.identity_verification`. Таблицы `verification_roots` и
`verification_attestations` образуют web of trust между уже существующими Core
Subjects. Root считается верифицированным непосредственно; любой другой subject
считается верифицированным, если достижим от root по активным attestations.

`verification points` — число активных входящих attestations от уже
верифицированных subjects. Self-verification запрещена, одна пара
`verifier → subject` может иметь не более одной активной записи, а отзыв
заполняет `revoked_at` и не удаляет историю. Добавление root доступно только
prototype-admin из `ADMIN_PARTICIPANT_IDS`, но само присутствие UUID в этой
переменной root не создаёт. Legacy `verified` автоматически не мигрируется.

Verification не изменяет membership, login, Proposal eligibility или reputation.
События `verification.root_added`, `verification.attestation_created` и
`verification.attestation_revoked` сохраняют audit history этих действий.

### Tokenization v0.1

DARUS — отдельная от Кармы внутренняя валюта. `darus_ledger` хранит только
добавляемые начисления с точной суммой `numeric(20,6)`; баланс участника всегда
вычисляется как `SUM(amount)` его записей. При создании новой Human Verification
attestation проверяется последняя действующая версия `reward_rules` для
`verification_created`. Если она включена, начисление верификатору и attestation
записываются в одной транзакции. Уникальный индекс ledger на пару
`verifier → subject` не допускает повторного начисления даже после revoke;
отзыв не списывает DARUS. Если тариф выключен, attestation всё равно создаётся.
На странице подтверждаемого человека игровой отклик запускается только по ID
фактически вставленной записи ledger. Сумма читается по этому ID с проверкой
верификатора и subject; одно лишь создание attestation не означает награду.

Изменение тарифа через `/admin/rewards` добавляет новую версию, сохраняя старые
версии и суммы ранее проведённых начислений. `effective_from` у новой версии —
время её создания; текущая версия выбирается по максимальному номеру среди
наступивших. `effective_to` ограничивает срок действия версии, если задан.
Начальная версия — `0.1 DARUS`, включена, автор `system`. Доступ к тарифам и
единой панели `/admin` использует существующий `ADMIN_PARTICIPANT_IDS`.

Проверить импорт можно напрямую:

```powershell
docker compose exec db psql -U dao -d dao -c "SELECT telegram_user_id, username, display_name, telegram_presence_status, telegram_last_seen_at, telegram_presence_observed_at, membership_status, identity_verification, participant_id FROM telegram_roster_entries ORDER BY display_name, telegram_user_id;"
```

### Participant Registry v0.1

Примени migrations и добавь внутренний UUID администратора в локальный `.env` (не в Git):

```dotenv
ADMIN_PARTICIPANT_IDS=00000000-0000-0000-0000-000000000001
```

Для нескольких локальных администраторов UUID перечисляются через запятую. Это явный временный allowlist прототипа: сервер сверяет с ним `participant.id` из действующей сессии. Пустое значение не даёт доступ никому. Механизм не является полноценной системой ролей и должен быть заменён Role/Permission моделью.

После пересоздания `web` войди под разрешённым Participant и открой:

`http://localhost:3000/admin/participants`

Страница позволяет искать по имени, username и Telegram ID, фильтровать roster по членству, канонической Human Verification и категории Telegram presence, а также менять административный статус членства. Обычный Participant перенаправляется из страницы в профиль и получает `403 Forbidden` при прямой попытке изменить запись через API.

Колонка верификации строится одной set-based проекцией существующего Web of Trust:
несвязанная roster entry показывает **«Нет профиля Core»**, достижимый от
verification root Participant — **«Личность подтверждена»**, а прочий связанный
Participant — **«Пока не подтверждена»**. Legacy-поле
`telegram_roster_entries.identity_verification` сохраняется только для
исторической совместимости, не отображается, не фильтруется и не редактируется
через Participant Registry.

Колонка **«Последний раз в Telegram»** отображает точное время в локальном часовом
поясе браузера, когда Telegram его раскрывает, либо исходную privacy-категорию.
Сортировки **«Давно не появлялись»** и **«Недавно появлялись»** используют широкие
группы давности; exact timestamps упорядочиваются внутри сопоставимой группы, а
coarse statuses не превращаются в вымышленные даты. `unknown` всегда остаётся
отдельной последней группой и не считается старым или неактивным аккаунтом.
Группы идут так: exact старше 30 дней; `last_month` и exact 7–30 дней;
`last_week` и exact 3–7 дней; `recently` и exact до 3 дней; `online`; затем
отдельно `unknown`.

Telegram presence не является активностью в ДАО и не порождает выводов
`inactive`, `silent` или «молчун». В дальнейшем активность Participant должна
иметь отдельное наблюдение вроде `last_observed_dao_activity_at`.

`membership_status` roster имеет значения `unknown`, `participant`, `left`, `excluded`, `bot`; импортированные legacy-записи получают `unknown`. Legacy `identity_verification` остаётся в схеме без синхронизации с каноническими `verification_roots` и `verification_attestations`.

#### Membership Binding v0.1

Сырой roster import по-прежнему только сохраняет snapshot и никогда не создаёт `Participant` или `ExternalIdentity`. Создание канонической Core identity разрешает отдельное институциональное действие: установка roster entry в одно из канонических состояний `participant`, `left` или `excluded`. Классификации `unknown` и `bot` сами по себе Core identity не создают.

При таком переходе Core под блокировкой roster entry:

1. использует уже связанный `participant_id`, если он есть;
2. иначе ищет Telegram `ExternalIdentity` по `external_user_id` и связывает её Participant с roster;
3. если обеих связей нет, создаёт один `Participant` с display name из roster, Telegram `ExternalIdentity` и заполняет `participant_id` roster entry.

Для нового Participant итоговый канонический статус в той же транзакции становится выбранным `participant`, `left` или `excluded`. Если Participant уже существовал, он переиспользуется без создания дубля. Telegram user ID защищён уникальным индексом среди Telegram identities. Противоречие между существующим roster link и Telegram identity считается integrity conflict: вся операция откатывается, данные не исправляются молча. Legacy/backfill переходы `unknown → left` и `unknown → excluded` создают соответственно `membership.left` и `membership.excluded`, но не выдумывают неизвестную дату предшествующего вступления и не создают `membership.joined`.

Создание/связывание identity, изменение `membership_status`, `participant.created` при создании нового Participant и `participant_registry.membership_status_changed` выполняются одной транзакцией. `identity_verification` эта операция не меняет. No-op не создаёт новые сущности или события.

До первого Telegram OIDC login roster-created identity использует технический `provider_subject`. При последующем login Core находит её по Telegram user ID, сохраняет фактический OIDC `sub` и создаёт сессию для того же Participant UUID.

#### Canonical Membership & Eligibility v0.1

`participants.membership_status` является единственным canonical source of truth
для текущего институционального членства и имеет только значения `none`,
`participant`, `left`, `excluded`. Техническая запись Participant является
долговременным каноническим субъектом Core; само её наличие не означает членство
DAO. Поле
`telegram_roster_entries.membership_status` остаётся Telegram-oriented
административным представлением: у несвязанной записи оно позволяет хранить
локальную классификацию `unknown` или `bot` и начать процедуру признания. После
связи с Participant переходы `participant`, `left` и `excluded` атомарно
синхронизируются с каноническим состоянием Participant.

`candidate` не является membership state: он относится к будущему отдельному
процессу `MembershipApplication`, который в этом vertical slice не реализован.
Первый Telegram OIDC/demo login создаёт Participant с `membership_status = none`;
Telegram join, presence, roster import и login сами по себе не создают членство.

Миграция `008_canonical_membership.sql` переносит legacy `candidate` в
институциональное roster-состояние только при наличии соответствующего explicit
registry recognition audit event. Остальные legacy `candidate` становятся
`none`. Membership History задним числом не создаётся. Противоречащие
roster-состояния, конфликт с уже установленным canonical state или обнаруженный
legacy `suspended` останавливают миграцию вместо молчаливой интерпретации данных.

Admission является отдельным институциональным решением. В действующей практике
положительное рассмотрение заявки завершается выдачей invite и признанием
членства. Спорная заявка может обсуждаться действующими участниками; неучастие в
обсуждении не записывается как голос или содержательное согласие, а означает
только отсутствие заявленного возражения против решения участвующими в
рассмотрении.

Eligibility не хранится отдельным флагом. Для каждого защищённого действия она
вычисляется сервером из canonical Participant state. В v0.1 первым таким
действием является создание Proposal: его может выполнить только Participant со
статусом `participant`. `none`, `left` и `excluded` не могут создавать Proposal,
но их существующие сессии не удаляются: субъект Core сохраняет identity и может
видеть допустимые профиль и историю.

#### Membership History v0.1

Текущее каноническое состояние хранится в `participants.membership_status`, а
каноническая биография членства — append-only событиями в уже существующей
таблице `events`. Отдельная таблица истории не создаётся, чтобы не появился
второй источник истины.

Ручные переходы Participant Registry создают следующие доменные события:

- `unknown → participant` — `membership.joined`;
- `participant → left` — `membership.left`;
- `left → participant` — `membership.rejoined`;
- `participant → excluded` — `membership.excluded`;
- `excluded → participant` — `membership.restored`.

`rejoined` и `restored` являются событиями биографии, а не новыми текущими
статусами. Изменения с участием `bot` и прочие классификационные переходы не
превращаются автоматически в политические события членства.

У membership event поле `events.participant_id` содержит канонический UUID
участника. Payload сохраняет автора административного действия, Telegram roster
ID, старое и новое состояния, источник `participant_registry` и `occurred_at`.
При первом `joined` Membership Binding сначала создаёт или находит Participant,
после чего история уже ссылается на этот UUID. Выход, исключение и возвращение
не меняют UUID.

Изменение текущего статуса, существующий registry audit event и membership event
записываются одной транзакцией. Registry audit отвечает на вопрос «кто изменил
поле», а Membership History — «что произошло с членством». No-op и переходы без
доменной семантики не создают membership event.

В `/profile` раздел **«История участия»** показывает только membership-события от
новых к старым, локальное время браузера и, для ручных действий, администратора.
Исторические изменения legacy verification остаются отдельными registry audit
events и в эту проекцию не входят.

Каждое фактическое изменение статуса и его audit event записываются одной транзакцией. Автор берётся только из серверной сессии. Авторизованный администратор также видит на `/profile` ссылку **«Участники ДАО»**; её скрытие для остальных пользователей является только UX, а серверные проверки страницы и API остаются обязательными и независимыми.

Событие `participant_registry.membership_status_changed` является текущей канонической audit history ручных изменений реестра. Ранее созданные `participant_registry.identity_verification_changed` сохраняются как исторические legacy events, но новые через Participant Registry больше не создаются. Отдельная таблица audit log не создаётся, и данные из `events` не дублируются.

No-op сохранение не является изменением состояния, поэтому событие для него не создаётся и в audit history оно не попадает. Нажатие кнопки само по себе не является административным событием.

## 7. Модель данных v0.1

### `participants`

Внутренний субъект DAO Core:

- `id` — UUID;
- `display_name`;
- `membership_status` — `none`, `participant`, `left` или `excluded`;
- `created_at`.

Новая identity при самостоятельном Telegram OIDC/demo login получает статус
`none`. Это создаёт канонический субъект Core, но не членство DAO. Participant,
созданный Membership Binding вследствие явного административного признания
roster entry участником, получает статус `participant`.

### `external_identities`

Связывает Participant с внешним провайдером. Для Telegram хранятся:

- OIDC `sub` как `provider_subject`; до первого OIDC login identity, созданная Membership Binding, использует техническое значение;
- Telegram user ID;
- username;
- first/last name;
- avatar URL.

В будущем сюда могут добавляться другие identity без изменения внутреннего Participant.

### `events`

Append-oriented журнал значимых событий. Пока:

- `participant.created`;
- `participant.logged_in`;
- `participant.profile_updated`;
- `proposal.created`;
- `telegram.message_created`;
- `participant_registry.membership_status_changed`;
- `participant_registry.identity_verification_changed`;
- `membership.joined`, `membership.left`, `membership.rejoined`;
- `membership.excluded`, `membership.restored`.

### `telegram_processed_updates`

Минимальный idempotency ledger Telegram webhook. Содержит уникальный `update_id` только для сообщений известных Participant; его создание и запись события происходят в одной транзакции.

### `telegram_roster_entries`

Одноразовый наблюдаемый snapshot состава Telegram-чата:

- `telegram_user_id` — первичный ключ;
- `username`, `display_name`, `is_bot`;
- `identity_verification` — `verified` или `unverified`, по умолчанию `unverified`;
- `membership_status` — Telegram-oriented административная классификация `unknown`, `participant`, `left`, `excluded` или `bot`, по умолчанию `unknown`; после связи институциональные значения синхронизируются с canonical Participant membership;
- nullable `participant_id`, заполняемый по существующей Telegram identity или при явном Membership Binding;
- `telegram_presence_status` — доступная категория Telegram presence;
- nullable `telegram_last_seen_at` — только точный `was_online`, без аппроксимации privacy-категорий;
- `telegram_presence_observed_at` — время snapshot, из которого получен presence;
- `observed_at` — время наблюдения snapshot.

### `proposals`

Простые предложения Governance v0.1:

- внутренний UUID;
- автор-Participant;
- заголовок и текст;
- статус `open`;
- дата создания.

### `sessions`

Серверные сессии. В БД хранится SHA-256 hash случайного session token; сам token находится только в HttpOnly cookie браузера.

## 8. Почему старый `tg-oauth-bridge` не используется

Legacy bridge был переходником между старым Telegram Login Widget и OAuth2, который требовался Discourse. DAO Core — собственное приложение, поэтому такой промежуточный OAuth-сервер больше не нужен.

Новый вход использует актуальный Telegram OIDC непосредственно.

## 9. Проверка Activity v0.2

Не расширять приложение сразу.

Сначала убедиться, что:

1. demo-login создаёт Participant с `membership_status = none`;
2. повторный вход использует тот же Participant;
3. `/profile` работает;
4. в `events` появляются `participant.created` и `participant.logged_in`;
5. изменение имени на `/profile` сохраняется после обновления страницы;
6. в `events` появляется `participant.profile_updated`, а событие видно на `/profile/activity`;
7. после этого настроить настоящий Telegram OIDC.

Только затем расширять набор событий активности.

## 10. Проверка Proposal v0.1

1. авторизованный Participant с canonical `membership_status = 'participant'` открывает `/veche`;
2. создаёт предложение с непустыми заголовком и текстом;
3. предложение появляется первым в списке;
4. в `events` появляется `proposal.created` с ID и заголовком предложения;
5. событие отображается на `/profile/activity` и учитывается в статистике активности.

## Перенос города и интересов из рассказов о себе

Разовый импорт: `npm run introductions:import -- <файл.json> [--dry-run|--apply]`.
Файл — список `{ "telegram_user_id": "…", "residence": { "name", "type", "country" } | null, "interests": ["…"] }`;
он содержит личные данные и в репозиторий не кладётся. Вывод — только счётчики.

Импорт заполняет только пустое: город — если его нет, интересы — если нет ни одного.
DARUS не начисляется, и соответствующее «первое действие» закрывается навсегда
(`onboarding_quest_completions`, origin `historical`). Человеку создаётся уведомление
(тексты `guardian.introduction_*` в `/admin/interface`) с доставкой через Хранителя.
Событие `profile.introduction_imported` делает повторный запуск безопасным: уже
обработанный участник пропускается, даже если он удалил перенесённое. Вышедшие и
исключённые пропускаются. Объявление новичка в форуме импорт не вызывает.
