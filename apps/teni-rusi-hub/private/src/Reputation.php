<?php
declare(strict_types=1);
namespace TeniRusi;

use PDO;

/**
 * Reputation counter, step 1: likes and dislikes under messages in the hub group.
 *  - The bot remembers only the number and the author of each group message (never its text).
 *  - A reaction from the approved list is a like or a dislike; any other emoji counts for nothing.
 *  - A person's own reactions to their own messages are not counted.
 *  - A reaction or message sent anonymously (as the group or a channel) is attributed to the operator:
 *    the operator is the only anonymous administrator (decision of 16 Nov 2026; revisit if that changes).
 *  - Who reacted is stored for correctness (one reaction per person and message) and is never shown;
 *    people see only their own totals. A score decides nothing about access: people do.
 * SQL is kept portable (REPLACE INTO, no ON DUPLICATE KEY) so the logic can be tested without MySQL.
 */
final class Reputation
{
    /** Positive reactions. Compared after the emoji variation selector U+FE0F is removed. */
    public const LIKE = ["\u{2764}", '👍', '🔥', '🥰', '👏', '🎉', '🤩', '🙏', '👌', '💯', '🏆', '🤝', '😍', '🫡'];
    public const DISLIKE = ['👎', '🤮', '💩', '🤬', '😡', '🤡', '🖕', '💔'];
    /** Telegram's stand-in sender for an administrator who posts anonymously in a group. */
    public const ANONYMOUS_ADMIN_BOT = 1087968824;
    /** Service messages: nobody "wrote" them, so nobody can be liked for them. */
    private const SERVICE = ['new_chat_members', 'left_chat_member', 'new_chat_title', 'new_chat_photo', 'delete_chat_photo',
        'pinned_message', 'forum_topic_created', 'forum_topic_edited', 'forum_topic_closed', 'forum_topic_reopened',
        'general_forum_topic_hidden', 'general_forum_topic_unhidden', 'message_auto_delete_timer_changed',
        'video_chat_started', 'video_chat_ended', 'video_chat_participants_invited', 'video_chat_scheduled'];
    private $clock;

    public function __construct(private PDO $db, private array $config, callable $clock)
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
    private function operator(): ?string
    {
        $o = $this->config['operator_chat_id'] ?? null;
        return Hub::userId($o) ? (string)$o : null;
    }
    private function inHubGroup(array $x): bool
    {
        return (string)($x['chat']['id'] ?? '') === (string)$this->config['chat_id'];
    }

    /** Remembers the number and author of a message in the hub group. Returns a result label for the polling report. */
    public function message(array $m): string
    {
        if (!$this->inHubGroup($m) || !is_int($m['message_id'] ?? null) || $m['message_id'] <= 0) return 'ignored';
        foreach (self::SERVICE as $key) if (isset($m[$key])) return 'ignored';
        $from = $m['from'] ?? null;
        $author = null;
        if (isset($m['sender_chat']) || (is_array($from) && ($from['id'] ?? null) === self::ANONYMOUS_ADMIN_BOT)) {
            $author = $this->operator();
        } elseif (is_array($from) && Hub::userId($from['id'] ?? null) && ($from['is_bot'] ?? false) !== true) {
            $author = (string)$from['id'];
        }
        if ($author === null) return 'ignored';
        $this->query('REPLACE INTO trh_group_messages(hub_id,message_id,author_id,created_at) VALUES (?,?,?,?)',
            [$this->hub(), $m['message_id'], $author, is_int($m['date'] ?? null) ? $m['date'] : $this->now()]);
        return 'group_message_recorded';
    }

    /** +1 for a like, -1 for a dislike, 0 when the set of reactions counts for nothing (or is balanced). */
    public static function signOf(array $reactions): int
    {
        $likes = $dislikes = 0;
        foreach ($reactions as $r) {
            if (!is_array($r) || ($r['type'] ?? null) !== 'emoji' || !is_string($r['emoji'] ?? null)) continue;
            $emoji = str_replace("\u{FE0F}", '', $r['emoji']);
            if (in_array($emoji, self::LIKE, true)) $likes++;
            elseif (in_array($emoji, self::DISLIKE, true)) $dislikes++;
        }
        return $likes <=> $dislikes;
    }

    /** One person's current reaction to one message (Telegram sends the full new set each time). */
    public function reaction(array $r): string
    {
        if (!$this->inHubGroup($r) || !is_int($r['message_id'] ?? null)) return 'ignored';
        $user = $r['user'] ?? null;
        if (is_array($user)) {
            $reactor = Hub::userId($user['id'] ?? null) && ($user['is_bot'] ?? false) !== true ? (string)$user['id'] : null;
        } else {
            $reactor = is_array($r['actor_chat'] ?? null) ? $this->operator() : null;
        }
        if ($reactor === null) return 'ignored';
        $row = $this->query('SELECT author_id FROM trh_group_messages WHERE hub_id=? AND message_id=?', [$this->hub(), $r['message_id']])->fetch();
        if (!$row) return 'reaction_unknown_message';
        $key = [$this->hub(), $r['message_id'], $reactor];
        if ($row['author_id'] === $reactor) {
            $this->query('DELETE FROM trh_reactions WHERE hub_id=? AND message_id=? AND reactor_id=?', $key);
            return 'reaction_own';
        }
        $sign = self::signOf(is_array($r['new_reaction'] ?? null) ? $r['new_reaction'] : []);
        if ($sign === 0) {
            $this->query('DELETE FROM trh_reactions WHERE hub_id=? AND message_id=? AND reactor_id=?', $key);
            return 'reaction_removed';
        }
        $this->query('REPLACE INTO trh_reactions(hub_id,message_id,reactor_id,author_id,sign,updated_at) VALUES (?,?,?,?,?,?)',
            [$this->hub(), $r['message_id'], $reactor, $row['author_id'], $sign, $this->now()]);
        return $sign > 0 ? 'reaction_like' : 'reaction_dislike';
    }

    /** Totals for one author: reactions and how many different people gave them. */
    public function score(string $user): array
    {
        $count = function (int $sign) use ($user): array {
            $q = $this->query('SELECT COUNT(*) AS n, COUNT(DISTINCT reactor_id) AS people FROM trh_reactions WHERE hub_id=? AND author_id=? AND sign=?',
                [$this->hub(), $user, $sign])->fetch();
            return [(int)$q['n'], (int)$q['people']];
        };
        [$likes, $likers] = $count(1);
        [$dislikes, $dislikers] = $count(-1);
        return ['likes' => $likes, 'likers' => $likers, 'dislikes' => $dislikes, 'dislikers' => $dislikers];
    }

    // ---- Signal about dislikes (step 2) -------------------------------------------------------
    /** Dislikes count over this window; the same window keeps the operator from being signalled twice about one person. */
    public const WINDOW = 2592000;
    /** Never fewer than this many different people, however small the group. */
    public const FLOOR = 3;

    /** One third of the people in the group (rounded up) is the bar for a signal. */
    public static function threshold(int $members): int
    {
        return max(self::FLOOR, intdiv($members + 2, 3));
    }

    /** Authors with dislikes from at least FLOOR different people over the window (a cheap prefilter: no Telegram call needed). */
    public function dislikeCandidates(): array
    {
        // The numbers are our own integers (not user input), written into the SQL so the comparison is numeric everywhere.
        return $this->query('SELECT author_id, COUNT(DISTINCT reactor_id) AS people FROM trh_reactions WHERE hub_id=? AND sign=-1 AND updated_at>=' . ($this->now() - self::WINDOW) .
            ' GROUP BY author_id HAVING COUNT(DISTINCT reactor_id) >= ' . self::FLOOR . ' ORDER BY people DESC', [$this->hub()])->fetchAll();
    }

    public function alertedRecently(string $user): bool
    {
        $t = $this->query('SELECT alerted_at FROM trh_rep_alerts WHERE hub_id=? AND user_id=?', [$this->hub(), $user])->fetchColumn();
        return $t !== false && (int)$t > $this->now() - self::WINDOW;
    }

    public function markAlerted(string $user, int $people): void
    {
        $this->query('REPLACE INTO trh_rep_alerts(hub_id,user_id,alerted_at,dislikers) VALUES (?,?,?,?)', [$this->hub(), $user, $this->now(), $people]);
    }

    /** Authors with the most likes, most first. The caller filters out people who may not be shown. */
    public function top(int $limit): array
    {
        return $this->query('SELECT author_id, COUNT(*) AS likes FROM trh_reactions WHERE hub_id=? AND sign=1 GROUP BY author_id ORDER BY likes DESC, COUNT(DISTINCT reactor_id) DESC, author_id LIMIT ' . max(1, min(100, $limit)),
            [$this->hub()])->fetchAll();
    }

    public static function text(array $s): string
    {
        return "Ваша репутация в группе:\n👍 лайков: {$s['likes']} (от разных людей: {$s['likers']})\n👎 дизлайков: {$s['dislikes']} (от разных людей: {$s['dislikers']})\n\n" .
            "Считаются реакции под вашими сообщениями в группе с момента запуска счётчика. Кто отреагировал, не показывается. " .
            'Решения о доступе принимают люди, а не счётчик.';
    }
}
