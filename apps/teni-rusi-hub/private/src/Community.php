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

    /** A ban in the hub group (status "kicked") is remembered; unbanning keeps the mark. */
    public function chatMember(array $cm): string
    {
        if ((string)($cm['chat']['id'] ?? '') !== $this->config['chat_id']) return 'ignored';
        $user = $cm['new_chat_member']['user'] ?? null;
        if (!is_array($user) || !Hub::userId($user['id'] ?? null)) return 'ignored';
        if (($cm['new_chat_member']['status'] ?? null) !== 'kicked' || ($cm['old_chat_member']['status'] ?? null) === 'kicked') return 'ignored';
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
