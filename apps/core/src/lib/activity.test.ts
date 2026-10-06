import { describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ pool: { query } }));
import { activityEventLabel, getActivitySummary } from "./activity";

describe("activityEventLabel", () => {
  it("returns a human-readable label for known events", () => {
    expect(activityEventLabel("participant.logged_in")).toBe("Вход в DAO Core");
    expect(activityEventLabel("participant.profile_updated")).toBe(
      "Изменение имени профиля",
    );
    expect(activityEventLabel("interface.texts_updated")).toBe("Изменение текстов интерфейса");
    expect(activityEventLabel("proposal.created")).toBe("Создание предложения");
    expect(activityEventLabel("code.comment_hide")).toBe("Скрытие комментария к Кодексу");
    expect(activityEventLabel("participant_registry.membership_status_changed")).toBe(
      "Изменение статуса членства в реестре",
    );
    expect(activityEventLabel("participant_registry.identity_verification_changed")).toBe(
      "Изменение верификации в реестре",
    );
    expect(activityEventLabel("verification.root_added")).toBe(
      "Добавлен корень человеческой верификации",
    );
    expect(activityEventLabel("verification.attestation_created")).toBe(
      "Создано подтверждение личности",
    );
    expect(activityEventLabel("verification.attestation_revoked")).toBe(
      "Отозвано подтверждение личности",
    );
    expect(activityEventLabel("membership.joined")).toBe("Принятие в ДАО");
    expect(activityEventLabel("membership.left")).toBe("Выход из ДАО");
    expect(activityEventLabel("membership.rejoined")).toBe("Возвращение в ДАО");
    expect(activityEventLabel("membership.excluded")).toBe("Исключение из ДАО");
    expect(activityEventLabel("membership.restored")).toBe("Восстановление в ДАО");
  });

  it("falls back to the raw event type for unknown events", () => {
    expect(activityEventLabel("proposal.updated")).toBe("proposal.updated");
  });
  it("excludes Angel technical events in both activity queries without deleting audit data", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await getActivitySummary("participant")).toMatchObject({ events7d: 0, events30d: 0, recentEvents: [] });
    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql] of query.mock.calls) {
      expect(sql).toContain("event_type NOT LIKE 'angel.%'");
      expect(sql).not.toMatch(/DELETE|UPDATE|INSERT/);
    }
  });
});
