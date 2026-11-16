<?php
declare(strict_types=1);
namespace TeniRusi;

use PDO;

/**
 * Vote on excluding a person from the group. People decide, the operator carries it out.
 *  - The operator opens a vote (/vote), after confirming it; a message with two buttons appears in the group.
 *  - Those who vote: people who accepted the rules (not under an exclusion mark) and people the operator
 *    confirmed with /voter. The list is fixed when the vote opens; the person in question does not vote.
 *  - The ballot is secret and final: the database keeps only that a person voted, and the two totals.
 *  - It lasts 3 days. It is valid when at least a third of the voters (and not fewer than 5) took part;
 *    it passes when at least two thirds of those who voted are for exclusion. The bot reports the result
 *    and does not exclude anyone itself.
 */
final class Vote
{
    public const DURATION = 259200;
    public const FLOOR = 5;
    private $clock;

    public function __construct(private PDO $db, private Bot $bot, private array $config, callable $clock, private Community $community)
    {
        $this->clock = $clock;
    }

    private function now(): int { return ($this->clock)(); }
    private function hub(): string { return $this->config['hub_id']; }
    private function query(string $sql, array $params = []): \PDOStatement
    {
        $q = $this->db->prepare($sql);
        $q->execute($params);
        return $q;
    }
    private function operator(): ?int
    {
        $o = $this->config['operator_chat_id'] ?? null;
        return Hub::userId($o) ? $o : null;
    }

    public static function quorum(int $voters): int { return max(self::FLOOR, intdiv($voters + 2, 3)); }
    /** At least two thirds of those who voted are for. */
    public static function passes(int $yes, int $no): bool { return $yes > 0 && $yes * 3 >= ($yes + $no) * 2; }
    public static function outcome(int $yes, int $no, int $quorum): string
    {
        if ($yes + $no < $quorum) return 'no_quorum';
        return self::passes($yes, $no) ? 'accepted' : 'rejected';
    }
    private static function moscow(int $unix): string { return gmdate('d.m H:i', $unix + 10800) . ' МСК'; }

    /** A person by numeric ID or @username, among those the bot has seen. */
    private function find(string $arg): ?string
    {
        $arg = trim($arg);
        if (preg_match('/^[0-9]{1,16}$/D', $arg) && Hub::userId((int)$arg)) return $arg;
        $name = ltrim($arg, '@');
        if (!preg_match('/^[A-Za-z0-9_]{1,64}$/D', $name)) return null;
        $id = $this->query('SELECT telegram_user_id FROM trh_people WHERE hub_id=? AND LOWER(username)=?', [$this->hub(), strtolower($name)])->fetchColumn();
        return $id === false ? null : (string)$id;
    }
    private function name(string $id): string { return Community::displayName($this->community->person($id)); }

    /** People who may vote now: accepted the rules and not excluded, plus those the operator confirmed. */
    private function voters(string $except): array
    {
        $ids = [];
        foreach ($this->query('SELECT telegram_user_id FROM trh_memberships WHERE hub_id=?', [$this->hub()])->fetchAll() as $r) {
            if ($this->community->isMember((string)$r['telegram_user_id'])) $ids[(string)$r['telegram_user_id']] = true;
        }
        foreach ($this->query('SELECT user_id,added_at FROM trh_voters WHERE hub_id=?', [$this->hub()])->fetchAll() as $r) {
            $excluded = $this->community->excludedAt((string)$r['user_id']);
            if ($excluded === null || $excluded < (int)$r['added_at']) $ids[(string)$r['user_id']] = true;
        }
        unset($ids[$except]);
        return array_map('strval', array_keys($ids));
    }

    /** /vote and /voter from the operator. Returns a label, or null when the text is neither. */
    public function operatorCommand(string $text, int $operator): ?string
    {
        if (!preg_match('/^\/(vote|voter)(?:@\w+)?(?:\s+(\S+))?\s*$/Du', $text, $m)) return null;
        $say = fn(string $t, array $extra = []) => $this->bot->call('sendMessage', ['chat_id' => $operator, 'text' => $t] + $extra);
        $target = isset($m[2]) ? $this->find($m[2]) : null;
        if ($target === null) {
            $say($m[1] === 'vote'
                ? 'Укажите человека: /vote @username или /vote числовой_id. Бот знает тех, кто писал в группу, ставил реакции или обращался к нему.'
                : 'Укажите человека: /voter @username или /voter числовой_id. Он сможет голосовать, не принимая правила в боте.');
            return 'vote_hint';
        }
        if ($m[1] === 'voter') {
            $this->query('DELETE FROM trh_voters WHERE hub_id=? AND user_id=?', [$this->hub(), $target]);
            $this->query('INSERT INTO trh_voters(hub_id,user_id,added_at) VALUES (?,?,?)', [$this->hub(), $target, $this->now()]);
            $say('В число голосующих добавлен: ' . $this->name($target) . '.');
            return 'voter_added';
        }
        if ($target === (string)$operator) { $say('Вопрос об исключении организатора здесь не ставится.'); return 'vote_refused'; }
        $open = $this->query("SELECT 1 FROM trh_votes WHERE hub_id=? AND subject_id=? AND status IN ('draft','open')", [$this->hub(), $target])->fetch();
        if ($open) { $say('Голосование по этому человеку уже готовится или идёт.'); return 'vote_refused'; }
        $id = bin2hex(random_bytes(8));
        $this->query("INSERT INTO trh_votes(id,hub_id,subject_id,status,created_at) VALUES (?,?,?,'draft',?)", [$id, $this->hub(), $target, $this->now()]);
        $n = count($this->voters($target));
        $say('Открыть в группе голосование об исключении: ' . $this->name($target) . "?\nСейчас могут голосовать: $n, кворум: " . self::quorum($n) . '. Голосование идёт 3 суток.',
            ['reply_markup' => ['inline_keyboard' => [[
                ['text' => 'Открыть', 'callback_data' => 'trh:v:go:' . $id],
                ['text' => 'Отмена', 'callback_data' => 'trh:v:no:' . $id],
            ]]]]);
        return 'vote_draft';
    }

    /** Buttons: the operator opens or cancels a draft; voters press «За» or «Против». */
    public function callback(array $cb): string
    {
        if (!is_string($cb['id'] ?? null) || !Hub::userId($cb['from']['id'] ?? null) ||
            !preg_match('/^trh:v:(y|n|go|no):([a-f0-9]{16})$/D', (string)($cb['data'] ?? ''), $m)) return 'ignored';
        $answer = fn(string $t) => $this->bot->call('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => $t]);
        $vote = $this->query('SELECT * FROM trh_votes WHERE id=? AND hub_id=?', [$m[2], $this->hub()])->fetch();
        if (!$vote) { $answer('Голосование не найдено.'); return 'vote_stale'; }
        $user = (string)$cb['from']['id'];

        if ($m[1] === 'go' || $m[1] === 'no') {
            if ($cb['from']['id'] !== $this->operator()) { $answer('Это решает организатор.'); return 'vote_ignored'; }
            if ($vote['status'] !== 'draft') { $answer('Уже обработано.'); return 'vote_stale'; }
            $edit = fn(string $t) => is_int($cb['message']['message_id'] ?? null) ? $this->bot->call('editMessageText',
                ['chat_id' => $this->operator(), 'message_id' => $cb['message']['message_id'], 'text' => $t]) : null;
            if ($m[1] === 'no') {
                $this->query("UPDATE trh_votes SET status='cancelled' WHERE id=? AND status='draft'", [$vote['id']]);
                $answer('Отменено.'); $edit('Голосование не открыто: отменено.');
                return 'vote_cancelled';
            }
            return $this->open($vote, $answer, $edit);
        }

        if ($vote['status'] !== 'open' || (int)$vote['ends_at'] <= $this->now()) { $answer('Голосование закончено.'); return 'vote_closed'; }
        $this->db->beginTransaction();
        try {
            if (!$this->query('SELECT 1 FROM trh_vote_rolls WHERE vote_id=? AND user_id=?', [$vote['id'], $user])->fetch()) {
                $this->db->rollBack();
                $answer('Вы не входите в число голосующих по этому вопросу.');
                return 'vote_not_voter';
            }
            try {
                $this->query('INSERT INTO trh_vote_ballots(vote_id,user_id) VALUES (?,?)', [$vote['id'], $user]);
            } catch (\PDOException $e) {
                if ($e->getCode() !== '23000') throw $e;
                $this->db->rollBack();
                $answer('Вы уже проголосовали. Голос нельзя изменить.');
                return 'vote_repeat';
            }
            $this->query('UPDATE trh_votes SET ' . ($m[1] === 'y' ? 'yes_n=yes_n+1' : 'no_n=no_n+1') . " WHERE id=? AND status='open'", [$vote['id']]);
            $this->db->commit();
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
        $answer('Голос принят. Он тайный: никто не увидит, как вы проголосовали.');
        return 'vote_cast';
    }

    private function open(array $vote, callable $answer, callable $edit): string
    {
        $subject = (string)$vote['subject_id'];
        $voters = $this->voters($subject);
        $n = count($voters);
        $quorum = self::quorum($n);
        $ends = $this->now() + self::DURATION;
        $this->db->beginTransaction();
        try {
            $claimed = $this->query("UPDATE trh_votes SET status='open',ends_at=?,roll_n=?,quorum=? WHERE id=? AND status='draft'", [$ends, $n, $quorum, $vote['id']]);
            if ($claimed->rowCount() !== 1) { $this->db->rollBack(); $answer('Уже обработано.'); return 'vote_stale'; }
            foreach ($voters as $id) $this->query('INSERT INTO trh_vote_rolls(vote_id,user_id) VALUES (?,?)', [$vote['id'], $id]);
            $this->db->commit();
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
        $sent = $this->bot->call('sendMessage', ['chat_id' => $this->config['chat_id'],
            'text' => 'Голосование об исключении из группы: ' . $this->name($subject) . ".\n\n" .
                'Голосуют участники, принявшие правила, и те, кого организатор подтвердил как участников ДАО. Голос тайный, изменить его нельзя. ' .
                'Голосование идёт до ' . self::moscow($ends) . ".\n\n" .
                "Решение действительно, если проголосовали не меньше $quorum человек; исключение принимается, если за него не меньше двух третей проголосовавших.",
            'reply_markup' => ['inline_keyboard' => [[
                ['text' => 'За исключение', 'callback_data' => 'trh:v:y:' . $vote['id']],
                ['text' => 'Против', 'callback_data' => 'trh:v:n:' . $vote['id']],
            ]]]]);
        if (empty($sent['ok'])) {
            // Nobody saw it: back out so the operator can try again.
            $this->query("UPDATE trh_votes SET status='cancelled' WHERE id=?", [$vote['id']]);
            $this->query('DELETE FROM trh_vote_rolls WHERE vote_id=?', [$vote['id']]);
            $answer('Не удалось написать в группу.'); $edit('Голосование не открыто: Telegram не принял сообщение в группу. Попробуйте ещё раз.');
            return 'vote_send_failed';
        }
        if (is_int($sent['result']['message_id'] ?? null)) {
            $this->query('UPDATE trh_votes SET message_id=? WHERE id=?', [$sent['result']['message_id'], $vote['id']]);
        }
        $answer('Открыто.'); $edit('Голосование открыто в группе. Могут голосовать: ' . $n . ', кворум: ' . $quorum . '.');
        return 'vote_opened';
    }

    /** Closes the votes whose time is up: reports the result in the group and to the operator. */
    public function tick(): string
    {
        $due = $this->query("SELECT * FROM trh_votes WHERE hub_id=? AND status='open' AND ends_at<=? LIMIT 20", [$this->hub(), $this->now()])->fetchAll();
        $closed = 0;
        foreach ($due as $v) {
            $outcome = self::outcome((int)$v['yes_n'], (int)$v['no_n'], (int)$v['quorum']);
            $claimed = $this->query("UPDATE trh_votes SET status='closed',outcome=? WHERE id=? AND status='open'", [$outcome, $v['id']]);
            if ($claimed->rowCount() !== 1) continue;
            $closed++;
            $name = $this->name((string)$v['subject_id']);
            $voted = (int)$v['yes_n'] + (int)$v['no_n'];
            $verdict = match ($outcome) {
                'accepted' => 'Решение: исключение принято.',
                'rejected' => 'Решение: исключение не принято.',
                default => 'Голосование не состоялось: не набрался кворум (нужно ' . (int)$v['quorum'] . ').',
            };
            $summary = "Голосование об исключении: $name, закончено.\nПроголосовало $voted из " . (int)$v['roll_n'] .
                ': за — ' . (int)$v['yes_n'] . ', против — ' . (int)$v['no_n'] . ".\n" . $verdict;
            if (is_int($v['message_id'] ?? null) || ctype_digit((string)($v['message_id'] ?? ''))) {
                $this->bot->call('editMessageReplyMarkup', ['chat_id' => $this->config['chat_id'], 'message_id' => (int)$v['message_id'], 'reply_markup' => ['inline_keyboard' => []]]);
            }
            $this->bot->call('sendMessage', ['chat_id' => $this->config['chat_id'], 'text' => $summary] +
                ($v['message_id'] !== null ? ['reply_parameters' => ['message_id' => (int)$v['message_id'], 'allow_sending_without_reply' => true]] : []));
            $this->community->notifyOperator($summary . ($outcome === 'accepted' ? "\n\nИсключение выполняете вы." : ''));
        }
        return 'votes_closed_' . $closed;
    }
}
