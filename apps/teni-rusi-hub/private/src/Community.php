<?php
declare(strict_types=1);
namespace TeniRusi;

use PDO;

/**
 * Minimal community functions of the hub while DAO Core is unavailable:
 *  - names of people the bot has seen (for the operator's list);
 *  - exclusion marks: a ban in the hub group is remembered for later join requests;
 *  - membership in the hub group and /members for the operator.
 * Exchange and the switchboard live in Network.php.
 * Keyed by Telegram user ID so the data can later be carried into DAO Core.
 */
final class Community
{
    private $clock;

    public function __construct(private PDO $db, private Bot $bot, private array $config, callable $clock)
    {
        $this->clock = $clock;
    }

    private function now(): int { return ($this->clock)(); }
    private function query(string $sql, array $params = []): \PDOStatement
    {
        $q = $this->db->prepare($sql);
        $q->execute($params);
        return $q;
    }
    private function hub(): string { return $this->config['hub_id']; }
    private function operator(): ?int
    {
        $o = $this->config['operator_chat_id'] ?? null;
        return Hub::userId($o) ? $o : null;
    }
    public function notifyOperator(string $text, array $extra = []): void
    {
        if ($this->operator() !== null) $this->bot->call('sendMessage', ['chat_id' => $this->operator(), 'text' => $text] + $extra);
    }

    public static function u16(string $s): int
    {
        return intdiv(strlen(mb_convert_encoding($s, 'UTF-16LE', 'UTF-8')), 2);
    }

    // ---- People -----------------------------------------------------------------------

    /** Keeps the latest name and @username of every person seen in an update. */
    public function remember(array $update): void
    {
        $users = [
            $update['chat_join_request']['from'] ?? null,
            $update['callback_query']['from'] ?? null,
            ($update['message']['chat']['type'] ?? null) === 'private' ? ($update['message']['from'] ?? null) : null,
            $update['chat_member']['new_chat_member']['user'] ?? null,
            // Names of people seen in the hub group (authors and reactors), so a vote can name them.
            (string)($update['message']['chat']['id'] ?? '') === $this->config['chat_id'] ? ($update['message']['from'] ?? null) : null,
            (string)($update['message_reaction']['chat']['id'] ?? '') === $this->config['chat_id'] ? ($update['message_reaction']['user'] ?? null) : null,
        ];
        foreach ($users as $u) if (is_array($u)) $this->rememberUser($u);
    }

    public function rememberUser(array $u): void
    {
        if (!Hub::userId($u['id'] ?? null) || ($u['is_bot'] ?? false) === true) return;
        $first = mb_substr(is_string($u['first_name'] ?? null) ? $u['first_name'] : '', 0, 255);
        $last = is_string($u['last_name'] ?? null) ? mb_substr($u['last_name'], 0, 255) : null;
        $username = is_string($u['username'] ?? null) && preg_match('/^[A-Za-z0-9_]{1,64}$/D', $u['username']) ? $u['username'] : null;
        $this->query('INSERT INTO trh_people(hub_id,telegram_user_id,first_name,last_name,username,updated_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE first_name=VALUES(first_name),last_name=VALUES(last_name),username=VALUES(username),updated_at=VALUES(updated_at)',
            [$this->hub(), (string)$u['id'], $first, $last, $username, $this->now()]);
    }

    public function person(string $userId): ?array
    {
        $p = $this->query('SELECT first_name,last_name,username FROM trh_people WHERE hub_id=? AND telegram_user_id=?', [$this->hub(), $userId])->fetch();
        return $p ?: null;
    }

    public static function displayName(?array $p): string
    {
        $name = trim(($p['first_name'] ?? '') . ' ' . ($p['last_name'] ?? ''));
        return ($name !== '' ? $name : 'без имени') . (!empty($p['username']) ? ' (@' . $p['username'] . ')' : '');
    }

    // ---- Exclusions -------------------------------------------------------------------

    /** In the group as Telegram reports it: a member, or restricted but still inside. */
    private static function inGroup(array $m): bool
    {
        $s = $m['status'] ?? null;
        return in_array($s, ['member', 'administrator', 'creator'], true) || ($s === 'restricted' && !empty($m['is_member']));
    }

    /**
     * Every departure from the hub group goes to the departure list: left by themselves, or removed
     * (banned, or removed by an administrator and unbanned at once). A ban is also remembered as an
     * exclusion mark; unbanning keeps the mark.
     */
    public function chatMember(array $cm): string
    {
        if ((string)($cm['chat']['id'] ?? '') !== $this->config['chat_id']) return 'ignored';
        $user = $cm['new_chat_member']['user'] ?? null;
        if (!is_array($user) || !Hub::userId($user['id'] ?? null)) return 'ignored';
        $new = $cm['new_chat_member']['status'] ?? null;
        $departure = null;
        if (is_array($cm['old_chat_member'] ?? null) && self::inGroup($cm['old_chat_member']) && in_array($new, ['left', 'kicked'], true) && ($user['is_bot'] ?? false) !== true) {
            $by = Hub::userId($cm['from']['id'] ?? null) ? (string)$cm['from']['id'] : null;
            $kind = $new === 'left' && $by === (string)$user['id'] ? 'left' : 'removed';
            try {
                $this->query('REPLACE INTO trh_departures(hub_id,user_id,left_at,kind,by_id) VALUES (?,?,?,?,?)',
                    [$this->hub(), (string)$user['id'], is_int($cm['date'] ?? null) ? $cm['date'] : $this->now(), $kind, $kind === 'removed' ? $by : null]);
                $departure = 'departure_recorded';
            } catch (\PDOException $e) {
                // The list must never stop the update queue (a missing table, say): the exclusion mark below still works.
                error_log('departure storage error ' . $e->getCode());
                $departure = 'departure_error';
            }
        }
        if ($new !== 'kicked' || ($cm['old_chat_member']['status'] ?? null) === 'kicked') return $departure ?? 'ignored';
        $by = Hub::userId($cm['from']['id'] ?? null) ? (string)$cm['from']['id'] : null;
        $date = is_int($cm['date'] ?? null) ? $cm['date'] : $this->now();
        $this->query('INSERT INTO trh_exclusions(hub_id,telegram_user_id,excluded_at,excluded_by,times) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE excluded_at=VALUES(excluded_at),excluded_by=VALUES(excluded_by),times=times+1',
            [$this->hub(), (string)$user['id'], $date, $by]);
        $this->notifyOperator('Отмечено исключение из группы: ' . self::displayName($this->person((string)$user['id']) ?? $user) .
            '. Если этот человек снова подаст заявку, решение будет за вами.');
        return 'exclusion_recorded';
    }

    public function excludedAt(string $userId): ?int
    {
        $e = $this->query('SELECT excluded_at FROM trh_exclusions WHERE hub_id=? AND telegram_user_id=?', [$this->hub(), $userId])->fetch();
        return $e ? (int)$e['excluded_at'] : null;
    }

    public static function date(int $unix): string { return gmdate('d.m.Y', $unix + 10800); }

    // ---- Membership ------------------------------------------------------------

    /**
     * Accepted the hub rules and is not under an exclusion mark. The mark stays as history;
     * a person the operator admitted again after it counts as a member.
     */
    public function isMember(string $userId): bool
    {
        if (!$this->query('SELECT 1 FROM trh_memberships WHERE hub_id=? AND telegram_user_id=?', [$this->hub(), $userId])->fetch()) return false;
        $excluded = $this->excludedAt($userId);
        return $excluded === null || (bool)$this->query("SELECT 1 FROM trh_requests WHERE hub_id=? AND telegram_user_id=? AND status='approved' AND event_date>?",
            [$this->hub(), $userId, $excluded])->fetch();
    }

    public function sendChunks(string $chatId, string $head, array $lines, array $extra = [], string $sep = "\n\n"): void
    {
        $chunks = [];
        $current = $head;
        foreach ($lines as $i => $line) {
            $glue = $i === 0 ? "\n\n" : $sep; // one blank line after the heading
            if (mb_strlen($current . $glue . $line) > 4000) { $chunks[] = $current; $current = $line; }
            else $current .= $glue . $line;
        }
        $chunks[] = $current;
        foreach ($chunks as $i => $c) {
            $this->bot->call('sendMessage', ['chat_id' => $chatId, 'text' => $c] + ($i === count($chunks) - 1 ? $extra : []));
        }
    }

    // ---- Operator list ----------------------------------------------------------------

    private const MONTHS = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

    /**
     * /left [days|all] for the operator: who left the group and when, newest first, grouped by month.
     * Counts people (a person who left twice is one person). The list starts from the day the
     * departure record was switched on; earlier history is in the archive of departures, not here.
     */
    public function departures(int $operator, ?string $arg): string
    {
        $all = $arg === 'all';
        $days = $all ? 0 : ($arg !== null && $arg !== '' ? max(1, min(3650, (int)$arg)) : 30);
        $since = $all ? 0 : $this->now() - $days * 86400;
        $rows = $this->query('SELECT d.user_id,d.left_at,d.kind,p.first_name,p.last_name,p.username,c.accepted_at FROM trh_departures d' .
            ' LEFT JOIN trh_people p ON p.hub_id=d.hub_id AND p.telegram_user_id=d.user_id' .
            ' LEFT JOIN trh_memberships m ON m.hub_id=d.hub_id AND m.telegram_user_id=d.user_id' .
            ' LEFT JOIN trh_consents c ON c.request_id=m.latest_consent_id' .
            ' WHERE d.hub_id=? AND d.left_at>=' . (int)$since . ' ORDER BY d.left_at DESC', [$this->hub()])->fetchAll();
        $people = [];
        foreach ($rows as $r) $people[$r['user_id']] = true;
        $period = $all ? 'за всё время записи' : 'за ' . $days . ' ' . self::plural($days, 'день', 'дня', 'дней');
        $head = 'Ушли из группы ' . $period . ': ' . count($people) . ' ' . self::plural(count($people), 'человек', 'человека', 'человек') .
            (count($rows) !== count($people) ? ' (выходов: ' . count($rows) . ')' : '') . '.';
        $lines = [];
        $month = null;
        foreach ($rows as $r) {
            $ts = (int)$r['left_at'] + 10800;
            $key = gmdate('Y-m', $ts);
            if ($key !== $month) {
                $month = $key;
                $lines[] = ($lines ? "\n" : '') . self::MONTHS[(int)gmdate('n', $ts)] . ' ' . gmdate('Y', $ts);
            }
            $lines[] = gmdate('d.m', $ts) . ' — ' . self::displayName($r) . ' — ' . ($r['kind'] === 'left' ? 'вышел' : 'удалён') .
                ($r['accepted_at'] ? '; принял правила ' . self::date((int)$r['accepted_at']) : '');
        }
        if (!$lines) $head .= "\n\nПока никого. Запись ведётся с момента её включения.";
        $this->sendChunks((string)$operator, $head, $lines, [], "\n");
        return 'departures_listed';
    }

    private static function plural(int $n, string $one, string $few, string $many): string
    {
        $m = $n % 100;
        if ($m >= 11 && $m <= 14) return $many;
        return match ($n % 10) { 1 => $one, 2, 3, 4 => $few, default => $many };
    }

    /** /members for the operator: everyone who accepted the rules, plus exclusion marks. */
    public function members(int $operator): string
    {
        $rows = $this->query('SELECT m.telegram_user_id,c.accepted_at,p.first_name,p.last_name,p.username,e.excluded_at FROM trh_memberships m LEFT JOIN trh_consents c ON c.request_id=m.latest_consent_id LEFT JOIN trh_people p ON p.hub_id=m.hub_id AND p.telegram_user_id=m.telegram_user_id LEFT JOIN trh_exclusions e ON e.hub_id=m.hub_id AND e.telegram_user_id=m.telegram_user_id WHERE m.hub_id=? ORDER BY c.accepted_at',
            [$this->hub()])->fetchAll();
        $lines = [];
        $inGroup = 0;
        foreach ($rows as $i => $r) {
            $member = $this->bot->call('getChatMember', ['chat_id' => $this->config['chat_id'], 'user_id' => (int)$r['telegram_user_id']]);
            $status = $member['result']['status'] ?? null;
            if (is_array($member['result']['user'] ?? null)) {
                $this->rememberUser($member['result']['user']);
                if ($r['first_name'] === null) $r = array_merge($r, $this->person($r['telegram_user_id']) ?? []);
            }
            $where = match (true) {
                in_array($status, ['member', 'administrator', 'creator'], true),
                $status === 'restricted' && !empty($member['result']['is_member']) => 'в группе',
                $status === 'left', $status === 'restricted' => 'вышел',
                $status === 'kicked' => 'забанен',
                default => 'статус неизвестен',
            };
            if ($where === 'в группе') $inGroup++;
            $lines[] = ($i + 1) . '. ' . self::displayName($r) . ' — принял ' . ($r['accepted_at'] ? self::date((int)$r['accepted_at']) : '?') .
                ', ' . $where . ($r['excluded_at'] !== null ? '; отметка: исключён ' . self::date((int)$r['excluded_at']) : '');
        }
        $others = $this->query('SELECT e.excluded_at,p.first_name,p.last_name,p.username FROM trh_exclusions e LEFT JOIN trh_people p ON p.hub_id=e.hub_id AND p.telegram_user_id=e.telegram_user_id LEFT JOIN trh_memberships m ON m.hub_id=e.hub_id AND m.telegram_user_id=e.telegram_user_id WHERE e.hub_id=? AND m.telegram_user_id IS NULL ORDER BY e.excluded_at',
            [$this->hub()])->fetchAll();
        foreach ($others as $o) $lines[] = 'Исключён ' . self::date((int)$o['excluded_at']) . ' (правила не принимал): ' . self::displayName($o);
        $head = 'Участники хаба: приняли правила — ' . count($rows) . ', из них в группе — ' . $inGroup . '.';
        if (!$lines) $head .= "\n\nПока никого.";
        $this->sendChunks((string)$operator, $head, $lines, [], "\n");
        return 'members_listed';
    }
}
