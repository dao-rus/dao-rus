# Однократная реконструкция архива убытия

Архив `@list_of_exites` предшествует Core для многих ушедших людей. Отсутствие
в текущем Core ожидаемо. Действующая модель review — `historical_username_v1`:
человек подтверждает видимый исторический `@username`, а не угадывает Participant
по имени. Все результаты первоначального dry-run неподтверждены. Apply выполняется
только отдельным явным запуском после ручного review и отдельного решения оператора.

## Историческая идентичность

- Подтверждённый архивный username достаточен как свидетельство бывшего участия.
- Для нового username будущий apply создаёт минимальный `participants`:
  `display_name = reviewed archived username без ведущего @`, `membership_status = 'left'`.
- `external_identities` не создаются: username не доказывает стабильный Telegram ID.
- Повторы username без учёта регистра используют одного реконструированного
  Participant, сохраняя отдельные события для отдельных archive message IDs.
- Точный current username из Telegram external identity или связанной current
  roster entry даёт `existing_current_username_match`. Новый дубликат заблокирован;
  человек явно выбирает подходящего текущего Participant либо оставляет unresolved.
  Существующий membership_status не меняется.
- Существующий исторический Participant определяется по immutable `participant.created`
  с source = admin_archive_reconstruction, source_channel и archived_username.
  Поэтому последующее изменение имени/статуса не создаёт дубликат. Несколько таких Participants требуют отдельного
  разрешения неоднозначности; importer их не объединяет.
- Без usable username запись остаётся `unresolved_no_username`. Совпадения имён,
  fuzzy matching, старые aliases и cached profiles не определяют цель импорта.

Usernames сравниваются без регистра ([Telegram FAQ](https://telegram.org/faq#q-what-are-usernames-how-do-i-get-one)).
Локальная проверка исторического написания принимает `@` и 4–32 ASCII букв,
цифр/подчёркиваний, хотя бы один буквенно-цифровой символ. Это консервативный
формат для архива (включая короткие исторические handles), не проверка доступности
username в Telegram. Видимый регистр, подтверждённый человеком, сохраняется.

## Экспорт и OCR

Историческое чтение — только существующая пользовательская MTProto/Telethon session
из `apps/core/tools/telegram/`, уже имеющая доступ к закрытому каналу. Bot API,
отправка сообщений, login/join и изменения membership не используются. Нужны локальные
`TELEGRAM_API_ID`, `TELEGRAM_API_HASH` и авторизованная session; секреты не передавать
в аргументах, Git, Core runtime или production.

Из `apps/core`:

```powershell
& .\.local\telegram-venv\Scripts\python.exe tools/telegram/export_departures.py
```

По умолчанию переиспользуется `.local/telegram/mtproto-roster.session`,
`--session <local-path>` выбирает другую авторизованную session. В
`.local/telegram/departures-<UTC>/` сохраняются полный доступный archive.json
с ID, исходной датой, caption/text, reply/album context, image metadata и локальные
images. Удалённые/недоступные сообщения восстановить нельзя. Неполный экспорт
не публикуется как archive.json. Отправитель и автор пересылки не считаются
ID ушедшего человека.

Для уже скачанных изображений повторный экспорт не нужен:

```powershell
& .\.local\telegram-venv\Scripts\python.exe -B tools/telegram/ocr_departures.py .local/telegram/departures-<UTC>/archive.json --tesseract "C:\Program Files\Tesseract-OCR\tesseract.exe" --language rus+eng
```

Tesseract PSM 11 сохраняет в локальном sidecar сырой OCR, words/confidence/bboxes
и image SHA-256. Исходный архив неизменен; sidecar связан с ним SHA-256. TSV читается
с `csv.QUOTE_NONE`: кавычки в распознанном тексте не должны поглощать соседние строки.
OCR — только подсказка, независимо от confidence. Нормализация не подменяет
Cyrillic/Latin confusables, O/0 или l/1; допускает пробелы/NFC/краевые украшения
имени и пробел после явного `@`. Повреждённый username не принимается по префиксу.
Имя показывается для контекста и не сопоставляется с Core.

## Dry-run и local human review

Для имеющегося архива и OCR sidecar:

```powershell
npm run telegram:departures:import -- .local/telegram/departures-20261005T080612Z/archive.json --dry-run --participants .local/telegram/departures-20261005T080612Z/participants-username-model.json --ocr-evidence .local/telegram/departures-20261005T080612Z/ocr-evidence-v2.json --output .local/telegram/departures-20261005T080612Z/departure-review-usernames-final.json --review-html .local/telegram/departures-20261005T080612Z/departure-username-review-final.html
```

Выходные файлы не перезаписываются: для повторного запуска выберите новые имена.
Без `--participants` требуется `DATABASE_URL` доступного Core PostgreSQL; загрузка
участников выполняется только внутри `BEGIN READ ONLY`. Общий SELECT находится
в `tools/telegram/departure_identity_query.sql`. Для офлайн работы snapshot содержит
`id`, `display_name`, `usernames`, `identity_evidence`, `reconstructed_archived_usernames`.
Исторические identity источники из прежнего workflow можно загрузить через
`--historical-roster`/`--historical-roster-dir`; они не превращаются в current collision
и не дают name-only соответствий в действующей модели.

JSON + Markdown показывают каждое сообщение, дату, OCR имя/username, варианты
username, текущие совпадения с IDs/именами/basis и состояние review. Summary содержит:
unique usable archived usernames, потенциальные новые/повторно используемые
исторические Participants, повторяющиеся группы message IDs, exact current collisions,
записи без username и записи с несколькими вариантами username.
Это прогноз по неподтверждённым OCR/caption/context подсказкам. Поле historical_participants_would_be_created считает потенциальные username-группы; historical_participants_creation_upper_bound ограничивает число новых Participants правилом одной цели на сообщение. Несколько usernames
в одной записи требуют выбора username именно ушедшего человека, поэтому количество
создаваемых Participants может уменьшиться после review. Исходных confirmed mappings — 0.

HTML включает все сообщения и встроенные screenshots. Откройте локально в обычном
браузере. Проверьте username по изображению, выберите подсказку или исправьте её вручную.
Архивное display name необязательно и вводится только после проверки; шумный OCR name
не копируется в mapping автоматически. Подтвердите исторический username либо
конкретного текущего/реконструированного Participant при точном совпадении. Изменение
username/name сбрасывает подтверждение. Без username возможен только unresolved.
Точное current совпадение блокирует создание нового исторического Participant.

Страница скачивает только reviewed mapping JSON. Нет DB/API endpoints, Telegram
credentials, browser storage или исходящих запросов (`connect-src 'none'`).
JSON экранируется, untrusted text вставляется через textContent. Решения до закрытия
страницы нужно скачать; «Продолжить из JSON» восстанавливает их после проверки
model version, channel, archive SHA, уникальности message IDs и допустимости целей.
Старые name-based reviewed файлы не подходят к новой модели.

## Будущий apply — отдельно, не выполнять во время dry-run

Пример подтверждённой mapping для нового исторического Participant:

```json
{
  "model_version": "historical_username_v1",
  "source_channel": "@list_of_exites",
  "archive_sha256": "<exact archive digest>",
  "mappings": [{
    "source_message_id": 10,
    "archived_username": "@historical_user",
    "archived_display_name": "Проверенное архивное имя",
    "participant_id": null,
    "target": "historical",
    "event_type": "forum.left",
    "confirmed": true
  }]
}
```

`target: "existing_current"` требует явного participant_id и точного актуального
username совпадения; `historical` с ID означает явно выбранного реконструированного
Participant. Apply повторно проверяет live DB, не доверяя устаревшему snapshot.
Вся партия проверяется на live collisions до первого INSERT. Нормализация: trim,
удаление ведущих @, повторный trim и lowercase. Короткий SHARE lock на
external_identities/telegram_roster_entries не допускает появления identity между
проверкой и commit; lock_timeout = 5s. При коллизии исторической цели batch остановлен.

Только после разрешения и review. Для frozen historical-only партии используйте
`--historical-only --expected-confirmed-count 40 --expected-confirmed-sha256 <digest>`.
Digest вычисляет exported `confirmedMappingDigest(review)`: SHA-256 canonical JSON
подтверждённых mappings, отсортированных по message ID. Count/digest проверяются
до подключения к DB. Historical-only режим останавливается при любой live collision,
включая уже имеющуюся departure provenance; не меняет existing Participants.
CLI и необходимые lib/SQL файлы включены в production image.

Общая команда:

```powershell
npm run telegram:departures:import -- .local/telegram/departures-<UTC>/archive.json --apply --review .local/telegram/departures-<UTC>/reviewed-departures-usernames.json
```

Одна транзакция создаёт минимальных Participants и immutable `forum.left`.
Для каждого нового Participant дополнительно создаётся `participant.created`
с source, source_channel, source_message_id, archived_username и archive_sha256.
Это provenance создания Participant; событие фиксируется во время импорта и
не выдаётся за историческое время создания аккаунта.
`events.created_at` и payload `observed_at` — исходная дата сообщения, нормализованная
в UTC, а не время запуска импортера. Payload: `source: admin_archive_reconstruction`,
`source_channel`, `source_message_id`, `archived_username`, `observed_at` и только
при ручном вводе `archived_display_name`. Скриншоты, captions, OCR и описания конфликтов
в события не попадают. Никаких external identities, UPDATE/DELETE legacy events,
изменений статуса существующих людей или вывода `forum.removed`.

Дедупликация — namespace реконструкции + source channel + message ID.
Lookup departure provenance обязательно ограничен `event_type = 'forum.left'`:
`participant.created` может иметь тот же source message ID и не является дублем выхода.
Transaction advisory lock сериализует importer runs, включая новые Participants
и одинаковые usernames. Повтор того же review пропускается; конфликт provenance,
даты, username или выбранного ID откатывает batch. Разные сообщения сохраняют
отдельные события. Все реконструкции должны соблюдать этот importer lock; миграции нет.

Архив, media, snapshots, HTML, reports, reviewed mapping и session содержат личные
данные и остаются в игнорируемом `.local/telegram/`, вне Git.

## Проверки

```powershell
npm test -- src/lib/telegram-departure-archive.test.ts src/lib/telegram-departure-review-html.test.ts src/lib/guardian-departures.test.ts
npm run typecheck
& .\.local\telegram-venv\Scripts\python.exe -B -m unittest discover -s tools/telegram -p 'test_*departures.py'
git diff --check
```

Apply проверяется transactional double; это не live PostgreSQL write/concurrency
проверка. Реальные production записи и Telegram export не являются частью повторного
офлайн dry-run. HTML workflow проверяется исполнением embedded JS с локальным DOM double.
