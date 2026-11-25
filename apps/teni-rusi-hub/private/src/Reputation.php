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
    /** A summary of changes goes out this long after the first change (decision of 25 Nov 2026). */
    public const NEWS_AFTER = 3600;
    /** The summary is deleted from the group after this long. */
    public const POST_LIFE = 300;
    private $clock;

    /** $news: keep changes for the summaries in the group (the hub group only; other chats stay silent). */
    public function __construct(private PDO $db, private array $config, callable $clock, private bool $news = false)
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
        // The topic is kept so a summary lands in the same topic of a forum group.
        $thread = ($m['is_topic_message'] ?? false) === true && is_int($m['message_thread_id'] ?? null) ? $m['message_thread_id'] : null;
        $this->query('REPLACE INTO trh_group_messages(hub_id,message_id,author_id,created_at,thread_id) VALUES (?,?,?,?,?)',
            [$this->hub(), $m['message_id'], $author, is_int($m['date'] ?? null) ? $m['date'] : $this->now(), $thread]);
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
        // Every way a reaction can fail to count has its own label, so the poll report says why.
        $user = $r['user'] ?? null;
        if (is_array($user)) {
            if (!Hub::userId($user['id'] ?? null)) return 'reaction_bad_user';
            if (($user['is_bot'] ?? false) === true) return 'reaction_bot';
            $reactor = (string)$user['id'];
        } elseif (is_array($r['actor_chat'] ?? null)) {
            $reactor = $this->operator();
            if ($reactor === null) return 'reaction_operator_unknown';
        } else {
            return 'reaction_no_actor';
        }
        $row = $this->query('SELECT author_id, thread_id FROM trh_group_messages WHERE hub_id=? AND message_id=?', [$this->hub(), $r['message_id']])->fetch();
        if (!$row) return 'reaction_unknown_message';
        $key = [$this->hub(), $r['message_id'], $reactor];
        if ($row['author_id'] === $reactor) {
            $this->query('DELETE FROM trh_reactions WHERE hub_id=? AND message_id=? AND reactor_id=?', $key);
            return 'reaction_own';
        }
        $old = $this->query('SELECT sign FROM trh_reactions WHERE hub_id=? AND message_id=? AND reactor_id=?', $key)->fetchColumn();
        $old = $old === false ? 0 : (int)$old;
        $sign = self::signOf(is_array($r['new_reaction'] ?? null) ? $r['new_reaction'] : []);
        if ($sign === 0) {
            $this->query('DELETE FROM trh_reactions WHERE hub_id=? AND message_id=? AND reactor_id=?', $key);
        } else {
            $this->query('REPLACE INTO trh_reactions(hub_id,message_id,reactor_id,author_id,sign,updated_at) VALUES (?,?,?,?,?,?)',
                [$this->hub(), $r['message_id'], $reactor, $row['author_id'], $sign, $this->now()]);
        }
        if ($this->news && $sign !== $old) {
            $this->noteChange((string)$row['author_id'], $sign - $old, $r['message_id'], $row['thread_id'] === null ? null : (int)$row['thread_id']);
        }
        if ($sign === 0) return 'reaction_removed';
        return $sign > 0 ? 'reaction_like' : 'reaction_dislike';
    }

    /** Reputation: likes minus dislikes under all the person's messages. */
    public function net(string $user): int
    {
        return (int)$this->query('SELECT COALESCE(SUM(sign),0) FROM trh_reactions WHERE hub_id=? AND author_id=?', [$this->hub(), $user])->fetchColumn();
    }

    // ---- Summaries in the group (25 Nov 2026) --------------------------------------------------
    /** Adds a change to the person's pending summary; the last message that got a reaction is the one replied to. */
    private function noteChange(string $user, int $delta, int $messageId, ?int $thread): void
    {
        $update = fn() => $this->query('UPDATE trh_rep_news SET delta=delta+?, message_id=?, thread_id=? WHERE hub_id=? AND user_id=?',
            [$delta, $messageId, $thread, $this->hub(), $user])->rowCount();
        if ($update() > 0) return;
        try {
            $this->query('INSERT INTO trh_rep_news(hub_id,user_id,delta,message_id,thread_id,started_at) VALUES (?,?,?,?,?,?)',
                [$this->hub(), $user, $delta, $messageId, $thread, $this->now()]);
        } catch (\PDOException $e) {
            // Another process inserted the row meanwhile: add to it.
            if ($update() === 0) throw $e;
        }
    }

    /** Summaries whose hour is over. */
    public function dueNews(int $limit = 20): array
    {
        return $this->query('SELECT user_id, delta, message_id, thread_id, started_at FROM trh_rep_news WHERE hub_id=? AND started_at<=' . ($this->now() - self::NEWS_AFTER) .
            ' ORDER BY started_at LIMIT ' . max(1, min(50, $limit)), [$this->hub()])->fetchAll();
    }

    /** Takes a due summary off the list. False when a new reaction changed it meanwhile: it is taken on the next pass. */
    public function claimNews(array $n): bool
    {
        return $this->query('DELETE FROM trh_rep_news WHERE hub_id=? AND user_id=? AND delta=? AND message_id=? AND started_at=?',
            [$this->hub(), $n['user_id'], (int)$n['delta'], (int)$n['message_id'], (int)$n['started_at']])->rowCount() === 1;
    }

    public function rememberPost(int $messageId): void
    {
        $this->query('REPLACE INTO trh_rep_posts(hub_id,message_id,delete_at) VALUES (?,?,?)', [$this->hub(), $messageId, $this->now() + self::POST_LIFE]);
    }

    /** The bot's summaries due for deletion. After 2 days Telegram no longer lets a bot delete, so older ones are forgotten. */
    public function duePosts(int $limit = 50): array
    {
        $this->query('DELETE FROM trh_rep_posts WHERE hub_id=? AND delete_at<' . ($this->now() - 172800), [$this->hub()]);
        return array_map('intval', $this->query('SELECT message_id FROM trh_rep_posts WHERE hub_id=? AND delete_at<=' . $this->now() .
            ' ORDER BY delete_at LIMIT ' . max(1, min(100, $limit)), [$this->hub()])->fetchAll(PDO::FETCH_COLUMN));
    }

    public function forgetPost(int $messageId): void
    {
        $this->query('DELETE FROM trh_rep_posts WHERE hub_id=? AND message_id=?', [$this->hub(), $messageId]);
    }

    /** Text of a summary. $name is the person's own name and @username. */
    public static function newsText(string $name, int $delta, int $total): string
    {
        $n = fn(int $x) => $x < 0 ? '−' . abs($x) : (string)$x;
        return $name . ', ваша репутация в хабе ' . ($delta > 0 ? 'выросла' : 'упала') . ' на ' . abs($delta) .
            ' и теперь составляет ' . $n($total) . ".\n\nСлава Руси!";
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

    /** One third of the active people (rounded up) is the bar for a signal. */
    public static function threshold(int $active): int
    {
        return max(self::FLOOR, intdiv($active + 2, 3));
    }

    /** Authors with dislikes from at least FLOOR different people over the window (a cheap prefilter: no Telegram call needed). */
    public function dislikeCandidates(): array
    {
        // The numbers are our own integers (not user input), written into the SQL so the comparison is numeric everywhere.
        return $this->query('SELECT author_id, COUNT(DISTINCT reactor_id) AS people FROM trh_reactions WHERE hub_id=? AND sign=-1 AND updated_at>=' . ($this->now() - self::WINDOW) .
            ' GROUP BY author_id HAVING COUNT(DISTINCT reactor_id) >= ' . self::FLOOR . ' ORDER BY people DESC', [$this->hub()])->fetchAll();
    }

    /**
     * Active people: those who wrote in the group or reacted to a message over the window. The bar for a
     * signal is a third of them, so a large silent group does not make it unreachable. Counted only from
     * what the counter has seen (it starts empty); until then the FLOOR decides.
     */
    public function activePeople(): int
    {
        $since = $this->now() - self::WINDOW;
        return (int)$this->query('SELECT COUNT(*) FROM (SELECT author_id AS u FROM trh_group_messages WHERE hub_id=? AND created_at>=' . $since .
            ' UNION SELECT reactor_id FROM trh_reactions WHERE hub_id=? AND updated_at>=' . $since . ') AS active', [$this->hub(), $this->hub()])->fetchColumn();
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

    /** Authors with the highest reputation (likes minus dislikes, above zero), highest first. The caller filters out people who may not be shown. */
    public function top(int $limit): array
    {
        return $this->query('SELECT author_id, SUM(sign) AS score FROM trh_reactions WHERE hub_id=? GROUP BY author_id HAVING SUM(sign) > 0 ORDER BY score DESC, COUNT(DISTINCT reactor_id) DESC, author_id LIMIT ' . max(1, min(100, $limit)),
            [$this->hub()])->fetchAll();
    }

    /** One group's totals under a heading: «Репутация в хабе: 17» and the likes and dislikes behind it. */
    public static function section(array $s, string $title): string
    {
        $net = $s['likes'] - $s['dislikes'];
        return "$title: " . ($net < 0 ? '−' . abs($net) : $net) .
            "\n👍 лайков: {$s['likes']} (от разных людей: {$s['likers']})\n👎 дизлайков: {$s['dislikes']} (от разных людей: {$s['dislikers']})";
    }

    public static function text(array $s): string
    {
        return self::section($s, 'Ваша репутация в хабе') . "\n\nКто отреагировал, не показывается.";
    }
}
