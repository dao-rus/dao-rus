import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasPrototypeAdminAccess, telegramBotToken, telegramReceptionConfig } from "@/lib/config";
import { AdminCrumbs } from "../../../../components/admin-crumbs";
import { CoreNavigation } from "../../../../components/core-navigation";
import { getCurrentParticipant } from "@/lib/session";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { listSignalTypes } from "@/lib/signals";
import { orderSignalTypes, signalTypePresentation } from "@/lib/signal-presentation";
import {
  GUARDIAN_FEATURES, discussionTopicKey, featureEnabled, forumInternalId, forumMessageLink, readGuardianSettings, topicFor,
} from "@/lib/guardian-forum";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Хранитель: форум и маршруты" };

const featureLabels: Record<(typeof GUARDIAN_FEATURES)[number], [string, string]> = {
  departure_log: ["Запись об уходе в канале уходов", "Когда участник сам вышел из форума, Хранитель добавляет строку в канал уходов. Удалённых администратором не записывает."],
  exchange_discussion: ["Обсуждение записей в форуме", "Кнопка «Обсудить в Telegram» на карточке: Хранитель публикует запись в ветке её типа."],
  forum_buttons: ["Кнопки в форуме открывают Ядро внутри Telegram", "Нужны имя бота ниже и «основное мини-приложение» в BotFather. Иначе кнопки ведут в браузер."],
  newcomer_announcements: ["Объявления о новичках", "Когда новый участник впервые указал город или интересы, Хранитель пишет об этом в ветку новичков."],
  reception_greeting: ["Приёмная: приветствие и ответ на рассказ", "Бот Приёмной приглашает рассказать о себе по «Запустить» и подтверждает, что рассказ передан участникам."],
  reception_welcome: ["Приёмная: приветствие после вступления", "Когда человека приняли в форум, бот Приёмной один раз приветствует его и предлагает указать город и интересы."],
  notification_mini_app: ["Кнопки в личных уведомлениях открывают Ядро внутри Telegram", "Действует на все личные сообщения Хранителя с кнопкой."],
};

export default async function GuardianForumPage({ searchParams }: { searchParams: Promise<{ forum_update?: string; detail?: string }> }) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");
  const [settings, catalog, { values: texts }, params] = await Promise.all([
    readGuardianSettings(), listSignalTypes(), readInterfaceTexts(), searchParams]);
  const forumChatId = telegramReceptionConfig().forumChatId;
  const ready = Boolean(telegramBotToken() && forumInternalId(forumChatId));
  const types = orderSignalTypes(catalog.filter((type) => type.enabled && type.key !== "dating"));
  const topics = [{ key: "topic.newcomers", label: "Новички" },
    ...types.map((type) => ({ key: discussionTopicKey(type.key), label: `Обсуждение: ${signalTypePresentation(type, texts).navigationName}` }))];
  const message = {
    saved: "Настройки сохранены.", unchanged: "Изменений нет.",
    invalid: "Проверьте ссылки на ветки (они должны быть из этого форума), номер канала и имя бота.",
    test_ok: "Пробное сообщение отправлено. Проверьте, что оно появилось в нужном месте.",
    test_failed: "Telegram не принял сообщение",
  }[params.forum_update ?? ""];
  return (
    <main className="shell">
      <section className="card profile">
        <CoreNavigation />
        <div className="profileHeader">
          <div>
            <AdminCrumbs href="/admin/guardian/forum" />
            <h1>Форум и маршруты</h1>
            <p className="muted">Что Хранитель делает между Ядром и форумом. Каждую функцию можно выключить; уже опубликованные сообщения при этом остаются.</p>
          </div>
        </div>
        {ready ? null : <p className="formError">На сервере не заданы токен бота Хранителя или номер форума (TELEGRAM_BOT_TOKEN, TELEGRAM_FORUM_CHAT_ID). Публикация в форум не работает.</p>}
        {message ? <p className={params.forum_update === "invalid" || params.forum_update === "test_failed" ? "formError" : "formNotice"} role="status">
          {message}{params.forum_update === "test_failed" && params.detail ? `: ${params.detail}` : ""}</p> : null}
        <form className="interfaceForm" action="/api/admin/guardian/forum" method="post">
          <h2>Функции</h2>
          {GUARDIAN_FEATURES.map((feature) => <div className="interfaceField" key={feature}>
            <label className="interfaceReset"><input type="checkbox" name={`feature.${feature}`} defaultChecked={featureEnabled(settings, feature)} />
              {featureLabels[feature][0]}</label>
            <small className="muted">{featureLabels[feature][1]}</small>
          </div>)}
          <div className="interfaceField">
            <label htmlFor="miniapp-bot">Имя бота Хранителя (без @)</label>
            <input id="miniapp-bot" name="miniapp.bot" defaultValue={settings.get("miniapp.bot") ?? ""} maxLength={40} placeholder="например DaoRusGuardianBot" />
          </div>
          <div className="interfaceField">
            <label htmlFor="channel-departures">Канал уходов: номер или ссылка на любое сообщение</label>
            <input id="channel-departures" name="channel.departures" defaultValue={settings.get("channel.departures") ?? ""} placeholder="-100… или https://t.me/c/…/…" />
            <small className="muted">Канал закрытый, поэтому нужна ссылка на сообщение (в меню сообщения «Копировать ссылку») или его номер. Хранитель должен быть администратором канала с правом публикации.</small>
            <button className="button secondary compact" type="submit" name="test" value="channel.departures">Проверить</button>
          </div>
          <h2>Ветки форума</h2>
          <p className="muted">В Telegram откройте ветку, в её меню выберите «Копировать ссылку на тему» и вставьте сюда. Пустое поле выключает функцию для этой ветки.
            «Проверить» сохраняет настройки и отправляет в ветку пробное сообщение.</p>
          {topics.map((topic) => {
            const id = topicFor(settings, topic.key);
            return <div className="interfaceField" key={topic.key}>
              <label htmlFor={topic.key}>{topic.label}</label>
              <input id={topic.key} name={topic.key} defaultValue={id ? forumMessageLink(forumChatId, id) ?? String(id) : ""} placeholder="https://t.me/c/…/…" />
              <button className="button secondary compact" type="submit" name="test" value={topic.key}>Проверить</button>
            </div>;
          })}
          <button className="button primary" type="submit">Сохранить</button>
        </form>
      </section>
    </main>
  );
}
