import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CoreNavigation } from "../../../components/core-navigation";
import { GuardianCampaignForm } from "../../../components/guardian-campaign-form";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { getProfileInterestsCampaign } from "@/lib/guardian-campaign";
import { getGuardianAudience, type GuardianParticipant } from "@/lib/guardian-audience";
import { residenceLabel } from "@/lib/profile-about";
import { getCurrentParticipant } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Хранитель" };

type SearchParams = { city?: string; interest?: string | string[]; campaign?: string };

function ParticipantLinks({ people }: { people: GuardianParticipant[] }) {
  return people.length ? (
    <ul>
      {people.map((person) => (
        <li key={person.id}><Link href={`/profile/${person.id}`}>{person.displayName}</Link></li>
      ))}
    </ul>
  ) : <p className="muted">Таких участников нет.</p>;
}

export default async function GuardianPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const participant = await getCurrentParticipant();
  if (!participant) redirect("/");
  if (!hasPrototypeAdminAccess(participant.id)) redirect("/profile");

  const params = await searchParams;
  const selectedInterests = typeof params.interest === "string" ? [params.interest]
    : Array.isArray(params.interest) ? params.interest : [];
  const city = typeof params.city === "string" ? params.city : "";
  const [overview, campaign] = await Promise.all([
    getGuardianAudience({ city, interests: selectedInterests }),
    getProfileInterestsCampaign(),
  ]);

  return (
    <main className="shell">
      <section className="card profile">
        <CoreNavigation />
        <div className="profileHeader">
          <div><div className="eyebrow">DAO Core</div><h1>Хранитель</h1></div>
          <Link className="button secondary" href="/admin">К управлению</Link>
        </div>

        <h2>Незаполненные данные профиля</h2>
        <details>
          <summary>Не указан город: {overview.missingCity.length}</summary>
          <ParticipantLinks people={overview.missingCity} />
        </details>
        <details>
          <summary>Не указаны интересы: {overview.missingInterests.length}</summary>
          <ParticipantLinks people={overview.missingInterests} />
        </details>
        {campaign ? <section aria-label="Кампания интересов">
          <h3>Предложить заполнить интересы</h3>
          <p>{params.campaign === "launched" ? "Кампания запущена." : "Кампания уже запущена; повторная отправка недоступна."}</p>
          <p>Внутренних уведомлений создано: <strong>{campaign.recipientCount}</strong></p>
          <p>Telegram deliveries поставлено в очередь: <strong>{campaign.telegramDeliveryCount}</strong></p>
          <p>Текст сообщения: {campaign.text}</p>
          <p>Кнопка действия: {campaign.actionLabel}</p>
        </section> : <GuardianCampaignForm recipientCount={overview.missingInterests.length} />}

        <h2>Аудитория технического уведомления</h2>
        <p className="muted">Выборка доступна только для просмотра. Наличие Telegram ID не подтверждает возможность отправить личное сообщение.</p>
        <form method="get" className="registryFilters">
          <label><span>Город</span>
            <select name="city" defaultValue={city}>
              <option value="">Все города</option>
              {overview.cities.map((option) => (
                <option key={option.key} value={option.key}>{residenceLabel(option.residence)} ({option.residence.type})</option>
              ))}
            </select>
          </label>
          <label><span>Интересы (несколько: Ctrl/Cmd + выбор)</span>
            <select name="interest" multiple size={Math.min(Math.max(overview.interests.length, 2), 6)} defaultValue={selectedInterests}>
              {overview.interests.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
          <button className="button" type="submit">Показать</button>
          <Link className="button secondary" href="/admin/guardian">Сбросить</Link>
        </form>
        <details>
          <summary>Найдено участников: <strong>{overview.audience.length}</strong></summary>
          <div className="registryTableWrap">
            <table className="registryTable">
              <thead><tr><th>Участник</th><th>Telegram username</th><th>Telegram user ID</th></tr></thead>
              <tbody>
                {overview.audience.map((person) => (
                  <tr key={person.id}>
                    <td><Link href={`/profile/${person.id}`}>{person.displayName}</Link></td>
                    <td>{person.telegramUsername ? `@${person.telegramUsername}` : "—"}</td>
                    <td>{person.hasTelegramUserId ? "есть" : "нет"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </main>
  );
}
