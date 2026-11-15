<?php
declare(strict_types=1);
namespace TeniRusi;

use PDO;

/**
 * Minimal community functions of the hub while DAO Core is unavailable:
 *  - names of people the bot has seen (for the operator's list);
 *  - exclusion marks: a ban in the hub group is remembered for later join requests;
 *  - /members for the operator;
 *  - Exchange («Мне нужно» / «У меня есть»): members add records through the bot,
 *    each new record is also posted to the hub group.
 * Keyed by Telegram user ID so the data can later be carried into DAO Core.
 */
final class Community
{
    public const SIGNAL_MAX = 500;      // same limit as DAO Core signals
    public const ACTIVE_MAX = 10;       // active records per person
    public const DIALOG_TTL = 3600;     // how long the bot waits for the record text
    public const LIST_MAX = 40;
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

    private static function u16(string $s): int
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

    // ---- Membership & menu ------------------------------------------------------------

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

    public function menu(string $chatId): void
    {
        $this->bot->call('sendMessage', ['chat_id' => $chatId,
            'text' => "Обмен хаба Тени Руси.\n\n«Мне нужно» и «У меня есть» — короткие записи, которые видят участники хаба. Новая запись появляется в группе с вашим именем.",
            'reply_markup' => ['inline_keyboard' => [
                [['text' => 'Мне нужно', 'callback_data' => 'trh:x:need'], ['text' => 'У меня есть', 'callback_data' => 'trh:x:have']],
                [['text' => 'Обмен', 'callback_data' => 'trh:x:list'], ['text' => 'Мои записи', 'callback_data' => 'trh:x:mine']],
            ]]]);
    }

    // ---- Exchange ---------------------------------------------------------------------

    public function callback(array $cb): string
    {
        if (!is_string($cb['id'] ?? null) || !Hub::userId($cb['from']['id'] ?? null) || !is_string($cb['data'] ?? null) ||
            !preg_match('/^trh:x:(need|have|list|mine|del:([a-f0-9]{32}))$/D', $cb['data'], $m)) return 'ignored';
        $user = (string)$cb['from']['id'];
        $answer = fn(string $t) => $this->bot->call('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => $t]);
        if (!$this->isMember($user)) { $answer('Обмен доступен участникам хаба, принявшим его правила.'); return 'exchange_denied'; }
        if ($m[1] === 'need' || $m[1] === 'have') {
            $this->query('INSERT INTO trh_dialogs(hub_id,telegram_user_id,state,updated_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE state=VALUES(state),updated_at=VALUES(updated_at)',
                [$this->hub(), $user, $m[1], $this->now()]);
            $answer('Жду ваш текст');
            $this->bot->call('sendMessage', ['chat_id' => $user, 'text' => ($m[1] === 'need'
                ? 'Напишите одним сообщением, что вам нужно'
                : 'Напишите одним сообщением, что вы можете предложить') .
                ' (до ' . self::SIGNAL_MAX . ' символов). Запись увидят участники хаба. Передумали — напишите /start.']);
            return 'exchange_prompt';
        }
        if ($m[1] === 'list') { $answer('Обмен'); $this->sendList($user); return 'exchange_list'; }
        if ($m[1] === 'mine') { $answer('Мои записи'); $this->sendMine($user); return 'exchange_mine'; }
        $s = $this->query("SELECT * FROM trh_signals WHERE id=? AND hub_id=? AND telegram_user_id=? AND status='active'", [$m[2], $this->hub(), $user])->fetch();
        if (!$s) { $answer('Запись уже снята.'); return 'exchange_gone'; }
        $this->query("UPDATE trh_signals SET status='archived',archived_at=? WHERE id=?", [$this->now(), $s['id']]);
        if ($s['group_message_id'] !== null) {
            $this->bot->call('editMessageText', ['chat_id' => $this->config['chat_id'], 'message_id' => (int)$s['group_message_id'],
                'text' => 'Запись снята автором.']);
        }
        $answer('Запись снята');
        return 'exchange_archived';
    }

    public function clearDialog(string $userId): void
    {
        $this->query('DELETE FROM trh_dialogs WHERE hub_id=? AND telegram_user_id=?', [$this->hub(), $userId]);
    }

    /**
     * The text after «Мне нужно» / «У меня есть». Returns null when the bot is not waiting
     * for this person (the message is then handled as usual).
     */
    public function dialogInput(array $m): ?string
    {
        $user = (string)$m['from']['id'];
        $d = $this->query('SELECT state,updated_at FROM trh_dialogs WHERE hub_id=? AND telegram_user_id=?', [$this->hub(), $user])->fetch();
        if (!$d) return null;
        if ((int)$d['updated_at'] + self::DIALOG_TTL < $this->now() || !$this->isMember($user)) { $this->clearDialog($user); return null; }
        $text = is_string($m['text'] ?? null) ? trim($m['text']) : null;
        if ($text !== null && str_starts_with($text, '/')) { $this->clearDialog($user); return null; }
        $reply = fn(string $t) => $this->bot->call('sendMessage', ['chat_id' => $user, 'text' => $t]);
        if ($text === null || $text === '') { $reply('Пожалуйста, напишите запись текстом.'); return 'exchange_text_required'; }
        if (mb_strlen($text) > self::SIGNAL_MAX) { $reply('Получилось длиннее ' . self::SIGNAL_MAX . ' символов. Сократите и пришлите ещё раз.'); return 'exchange_too_long'; }
        $active = (int)$this->query("SELECT COUNT(*) FROM trh_signals WHERE hub_id=? AND telegram_user_id=? AND status='active'", [$this->hub(), $user])->fetchColumn();
        if ($active >= self::ACTIVE_MAX) {
            $this->clearDialog($user);
            $reply('У вас уже ' . self::ACTIVE_MAX . ' записей. Снимите старые в «Мои записи» и добавьте новую.');
            return 'exchange_limit';
        }
        $id = bin2hex(random_bytes(16));
        $this->query("INSERT INTO trh_signals(id,hub_id,telegram_user_id,kind,body,status,created_at) VALUES (?,?,?,?,?,'active',?)",
            [$id, $this->hub(), $user, $d['state'], $text, $this->now()]);
        $this->clearDialog($user);
        $posted = $this->postToGroup($id, $d['state'], $text, $user);
        $reply($posted ? '✓ Запись сохранена и опубликована в группе. Снять её можно в «Мои записи» (/start).'
            : '✓ Запись сохранена и видна в «Обмене». В группе опубликовать не удалось. Снять её можно в «Мои записи» (/start).');
        return 'exchange_saved';
    }

    private static function label(string $kind): string { return $kind === 'need' ? '🔎 Нужно' : '🤝 Есть'; }

    private function postToGroup(string $id, string $kind, string $body, string $user): bool
    {
        $p = $this->person($user);
        $name = trim(($p['first_name'] ?? '') . ' ' . ($p['last_name'] ?? ''));
        if ($name === '') $name = 'участник';
        $text = self::label($kind) . "\n\n" . $body . "\n\n— ";
        $entity = ['type' => 'text_mention', 'offset' => self::u16($text), 'length' => self::u16($name), 'user' => ['id' => (int)$user]];
        $text .= $name . (!empty($p['username']) ? ' (@' . $p['username'] . ')' : '');
        $sent = $this->bot->call('sendMessage', ['chat_id' => $this->config['chat_id'], 'text' => $text, 'entities' => [$entity]]);
        if (empty($sent['ok']) || !is_int($sent['result']['message_id'] ?? null)) return false;
        $this->query('UPDATE trh_signals SET group_message_id=? WHERE id=?', [$sent['result']['message_id'], $id]);
        return true;
    }

    private function sendChunks(string $chatId, string $head, array $lines, array $extra = [], string $sep = "\n\n"): void
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

    private function sendList(string $chatId): void
    {
        $rows = $this->query("SELECT s.kind,s.body,p.first_name,p.last_name,p.username FROM trh_signals s LEFT JOIN trh_people p ON p.hub_id=s.hub_id AND p.telegram_user_id=s.telegram_user_id WHERE s.hub_id=? AND s.status='active' ORDER BY s.created_at DESC LIMIT " . self::LIST_MAX,
            [$this->hub()])->fetchAll();
        if (!$rows) {
            $this->bot->call('sendMessage', ['chat_id' => $chatId, 'text' => 'В Обмене пока нет записей. Будьте первым: /start → «Мне нужно» или «У меня есть».']);
            return;
        }
        $lines = array_map(fn($r) => self::label($r['kind']) . ' — ' . self::displayName($r) . ":\n" . $r['body'], $rows);
        $this->sendChunks($chatId, 'Обмен хаба — свежие записи (' . count($rows) . '):', $lines);
    }

    private function sendMine(string $chatId): void
    {
        $rows = $this->query("SELECT id,kind,body FROM trh_signals WHERE hub_id=? AND telegram_user_id=? AND status='active' ORDER BY created_at",
            [$this->hub(), $chatId])->fetchAll();
        if (!$rows) {
            $this->bot->call('sendMessage', ['chat_id' => $chatId, 'text' => 'У вас нет активных записей. Добавить: /start → «Мне нужно» или «У меня есть».']);
            return;
        }
        $lines = [];
        $buttons = [];
        foreach ($rows as $i => $r) {
            $lines[] = ($i + 1) . '. ' . self::label($r['kind']) . ': ' . $r['body'];
            $buttons[] = ['text' => 'Снять ' . ($i + 1), 'callback_data' => 'trh:x:del:' . $r['id']];
        }
        $this->sendChunks($chatId, 'Ваши записи:', $lines, ['reply_markup' => ['inline_keyboard' => array_chunk($buttons, 5)]]);
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
