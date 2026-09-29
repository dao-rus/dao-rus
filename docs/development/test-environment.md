# Персональная тестовая среда DAO Rus на Linux

Цель: развернуть отдельную тестовую копию DAO Core, максимально близкую к production, но полностью изолированную от production-данных, секретов и Telegram-интеграций.

## Предварительные требования

Минимально достаточно:

- Linux-машина или VPS;
- 2 ГБ RAM и 10–20 ГБ диска;
- Git;
- Docker Engine;
- Docker Compose Plugin;
- доступ на чтение к `dao-rus/dao-rus`;
- отдельный домен или поддомен — только если нужен HTTPS / Telegram OIDC;
- отдельные тестовые Telegram credentials — только если тестируется реальная Telegram-интеграция.

Не использовать production PostgreSQL, `.env.production`, Bot Token, OIDC secret, webhook secret, production-домен или production Docker volumes.

## 1. Подготовить Linux

1. Войти на сервер по SSH.
2. Обновить индекс пакетов:
   ```bash
   sudo apt update
   ```
3. Установить Git:
   ```bash
   sudo apt install -y git
   ```
4. Установить Docker Engine штатным способом для используемого дистрибутива.
5. Установить Docker Compose Plugin.
6. Проверить:
   ```bash
   docker --version
   docker compose version
   ```

## 2. Получить код

7. Клонировать репозиторий:
   ```bash
   cd ~
   git clone https://github.com/dao-rus/dao-rus.git dao-rus-test
   ```
8. Перейти в репозиторий:
   ```bash
   cd ~/dao-rus-test
   ```
9. Проверить remote:
   ```bash
   git remote -v
   ```
10. Переключиться на `main` и обновиться:
   ```bash
   git switch main
   git pull --ff-only origin main
   ```

## 3. Создать отдельное окружение

11. Перейти в Core:
   ```bash
   cd ~/dao-rus-test/apps/core
   ```
12. Создать test env:
   ```bash
   cp .env.example .env.test
   ```
13. Сгенерировать отдельный пароль БД:
   ```bash
   openssl rand -hex 24
   ```
14. В `.env.test` задать отдельные значения:
   ```env
   POSTGRES_DB=dao_test
   POSTGRES_USER=dao_test
   POSTGRES_PASSWORD=<отдельный пароль>
   APP_BASE_URL=http://localhost:3000
   ```
15. Telegram-переменные оставить пустыми, если Telegram пока не тестируется.
16. Не копировать production secrets.

## 4. Создать отдельный Compose

17. Скопировать production Compose:
   ```bash
   cp compose.prod.yml compose.test.yml
   ```
18. В `compose.test.yml` изменить:
   ```yaml
   name: dao-core
   ```
   на:
   ```yaml
   name: dao-core-test
   ```
19. Если публичный HTTPS не нужен, удалить сервис `caddy`.
20. Если `caddy` удалён, в сервисе `web` добавить:
   ```yaml
   ports:
     - "3000:3000"
   ```
21. Не менять внутренние сервисные имена `db` и `web`.

## 5. Проверить конфигурацию

22. Проверить Compose:
   ```bash
   docker compose --env-file .env.test -f compose.test.yml config
   ```
23. Убедиться, что используются test DB, test project name и отсутствуют production secrets.

## 6. Собрать и запустить

24. Собрать образы:
   ```bash
   docker compose --env-file .env.test -f compose.test.yml build
   ```
25. Запустить БД:
   ```bash
   docker compose --env-file .env.test -f compose.test.yml up -d db
   ```
26. Проверить состояние:
   ```bash
   docker compose --env-file .env.test -f compose.test.yml ps
   ```
27. Выполнить миграции:
   ```bash
   docker compose --env-file .env.test -f compose.test.yml run --rm migrate
   ```
28. Запустить web:
   ```bash
   docker compose --env-file .env.test -f compose.test.yml up -d web
   ```
29. Проверить логи:
   ```bash
   docker compose --env-file .env.test -f compose.test.yml logs --tail=100 web
   ```

## 7. Проверить приложение

30. Проверить HTTP:
   ```bash
   curl -I http://localhost:3000
   ```
31. Открыть:
   ```text
   http://SERVER_IP:3000
   ```
32. Проверить основные маршруты и только тестовые данные.
33. Не импортировать production roster.
34. Не подключать production Telegram webhook.

## 8. Telegram — только при необходимости

35. Создать отдельного тестового Telegram-бота.
36. Получить отдельные `TELEGRAM_OIDC_CLIENT_ID`, `TELEGRAM_OIDC_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`.
37. Использовать отдельный test-домен, например:
   ```text
   test-core.daorus.org
   ```
38. Задать:
   ```env
   APP_BASE_URL=https://test-core.daorus.org
   TELEGRAM_OIDC_REDIRECT_URI=https://test-core.daorus.org/api/auth/telegram/callback
   ```
39. Зарегистрировать test URL в BotFather.
40. Для ingestion использовать отдельную тестовую группу и её `TELEGRAM_INGEST_CHAT_ID`.

## 9. HTTPS — только если нужен внешний доступ

41. Вернуть/оставить сервис `caddy`.
42. Направить test-домен на IP сервера.
43. Задать:
   ```env
   CORE_DOMAIN=test-core.daorus.org
   ```
44. Запустить Compose и проверить:
   ```bash
   curl -I https://test-core.daorus.org
   ```

## 10. Рабочий цикл разработчика

45. Перед работой обновить репозиторий:
   ```bash
   cd ~/dao-rus-test
   git fetch origin
   git switch main
   git pull --ff-only origin main
   ```
46. Создать отдельную ветку:
   ```bash
   git switch -c <имя-ветки>
   ```
47. Выполнить задачу.
48. Запустить проверки по уровню риска из `AGENTS.md`.
49. Для TypeScript-изменений выполнить:
   ```bash
   npm run typecheck
   ```
50. Для системных изменений выполнить полный набор нужных тестов.
51. Пересобрать test image:
   ```bash
   docker compose --env-file .env.test -f compose.test.yml build web
   ```
52. Применить изменения:
   ```bash
   docker compose --env-file .env.test -f compose.test.yml up -d
   ```
53. Проверить изменённый пользовательский сценарий.
54. Только после проверки оформлять PR.

## 11. Остановка и сброс

55. Остановить среду:
   ```bash
   docker compose --env-file .env.test -f compose.test.yml down
   ```
56. Не использовать `-v`, если test DB нужно сохранить.
57. Для полного сброса test DB:
   ```bash
   docker compose --env-file .env.test -f compose.test.yml down -v
   ```

## Рекомендуемое улучшение репозитория

Чтобы каждый разработчик не собирал тестовую среду вручную, стоит добавить в Git штатные:

- `apps/core/compose.test.yml`;
- `apps/core/.env.test.example`.

Тогда стандартный запуск сведётся примерно к:

```bash
git clone https://github.com/dao-rus/dao-rus.git
cd dao-rus/apps/core
cp .env.test.example .env.test
docker compose --env-file .env.test -f compose.test.yml up --build
```

Это уменьшит расхождения между персональными средами разных вайбкодеров.
