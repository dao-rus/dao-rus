<?php
declare(strict_types=1);
namespace TeniRusi;

use PDO;

/**
 * The switchboard (docs/architecture/switchboard-protocol-v0.md), step 1: the Telegram bot
 * is the client. People join by accepting the Code, leave records (need / have / want to
 * do / interest), search without seeing names or IDs, and are connected only on mutual
 * consent. A week after a connection both sides are asked for a review; trust levels follow
 * from reviews. Conversations are never stored.
 */
final class Network
{
    public const KINDS = ['need' => '🔎 Нужно', 'have' => '🤝 Есть', 'do' => '🛠 Хочу сделать', 'interest' => '💡 Интерес'];
    private const PROMPTS = [
        'need' => 'Напишите одним сообщением, что вам нужно',
        'have' => 'Напишите одним сообщением, что вы можете предложить',
        'do' => 'Напишите одним сообщением, что вы хотите сделать или начать',
        'interest' => 'Напишите одним сообщением, что вас занимает — тема, идея, вопрос; цель не обязательна',
    ];
    /** Kinds that, for members of the hub group, are also posted to the group (Exchange). */
    private const GROUP_KINDS = ['need', 'have'];
    public const BODY_MAX = 500;          // same limit as DAO Core records
    public const ACTIVE_MAX = 10;
    /** Life of a record by kind in seconds; null = no expiry. «Продлить» renews; a week before the end the author is asked. */
    public const TTL = ['need' => 7776000, 'have' => 7776000, 'do' => 15552000, 'interest' => null];
    public const WARN_BEFORE = 604800;
    public const MATCH_NOTIFY_MAX = 2;    // «похожая запись появилась» per person per day
    /** The persistent keyboard (always under the input field) and commands map to the same actions. */
    public const MENU = ['Мне нужно' => 'new:need', 'У меня есть' => 'new:have', 'Хочу сделать' => 'new:do', 'Интерес' => 'new:interest',
        'Найти людей' => 'find', 'Кто здесь' => 'who', 'Обмен' => 'list', 'Мои записи' => 'mine', 'О себе' => 'me',
        '/find' => 'find', '/who' => 'who', '/me' => 'me', '/menu' => 'menu', '/key' => 'key'];
    /** Keys for programs and AI assistants (step 2 of the protocol): at most KEYS_MAX live, a key unused for KEY_IDLE goes out. */
    public const KEYS_MAX = 5;
    public const KEY_IDLE = 7776000;
    public const DIALOG_TTL = 3600;
    public const ABOUT_MAX = 200;
    public const NOTE_MAX = 300;
    public const CITY_MAX = 100;
    public const RESULTS = 10;
    public const LIST_MAX = 30;
    public const MIN_GROUP = 3;           // «Кто здесь» shows only groups of at least 3 people
    public const REVIEW_AFTER = 604800;   // ask for a review a week after a connection
    public const REVIEW_WINDOW = 31536000;
    public const LIMITS = ['search' => 30, 'offer' => 5, 'request' => ['newcomer' => 5, 'trusted' => 20]];
    private const CODE_POINTS = [1 => 'напал первым', 2 => 'не уважал чужую свободу', 3 => 'шёл против народовластия'];
    private const STOP = ['и','в','во','на','не','что','как','это','с','со','по','для','за','от','до','из','у','о','об','а','но','или','ли','же',
        'бы','то','так','мне','меня','мой','моя','мои','я','мы','вы','он','она','они','его','её','их','нужно','нужен','нужна','нужны',
        'есть','хочу','хотим','могу','можем','кто','где','когда','чтобы','очень','ещё','уже','все','всё','при','про','над','под','без',
        'the','and','for','with'];
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
    private function send(string $chat, string $text, array $extra = []): array
    {
        return $this->bot->call('sendMessage', ['chat_id' => $chat, 'text' => $text] + $extra);
    }
    private static function buttons(array $rows): array { return ['reply_markup' => ['inline_keyboard' => $rows]]; }
    private static function keyboard(): array
    {
        $k = fn(string ...$labels) => array_map(fn($l) => ['text' => $l], $labels);
        return ['reply_markup' => ['keyboard' => [$k('Мне нужно', 'У меня есть'), $k('Хочу сделать', 'Интерес'), $k('Найти людей', 'Кто здесь'),
            $k('Обмен', 'Мои записи', 'О себе')], 'resize_keyboard' => true, 'is_persistent' => true, 'input_field_placeholder' => 'Выберите кнопку меню']];
    }
    private static function expiresAt(string $kind, int $now): ?int { $t = self::TTL[$kind] ?? null; return $t === null ? null : $now + $t; }
    private static function lifeText(string $kind): string
    {
        $t = self::TTL[$kind] ?? null;
        return $t === null ? 'Запись живёт без срока, пока вы её не снимете.' : 'Запись живёт ' . ($t >= 15552000 ? 'полгода' : '90 дней') . '; за неделю до конца я напомню.';
    }
    /** Night in Moscow (23:00–09:00): no unsolicited messages. */
    private function quiet(): bool { $h = (int)gmdate('G', $this->now() + 10800); return $h >= 23 || $h < 9; }
    private static function b(string $text, string $data): array { return ['text' => $text, 'callback_data' => $data]; }
    private function operator(): ?int
    {
        $o = $this->config['operator_chat_id'] ?? null;
        return Hub::userId($o) ? $o : null;
    }

    // ---- Words ------------------------------------------------------------------------

    /** Lower-case words without stop words; a word's stem is its first five letters (ловит падежи). */
    public static function words(string $text): array
    {
        $parts = preg_split('/[^\p{L}\p{N}]+/u', mb_strtolower(str_replace(['ё', 'Ё'], 'е', $text))) ?: [];
        return array_values(array_filter($parts, fn($w) => mb_strlen($w) >= 3 && !in_array($w, self::STOP, true)));
    }
    public static function stem(string $word): string { return mb_strlen($word) > 5 ? mb_substr($word, 0, 5) : $word; }
    public static function stems(string $text): array { return array_values(array_unique(array_map([self::class, 'stem'], self::words($text)))); }

    // ---- Membership, access, trust ------------------------------------------------------

    private function net(string $user): ?array
    {
        $r = $this->query('SELECT * FROM trh_net WHERE hub_id=? AND telegram_user_id=?', [$this->hub(), $user])->fetch();
        return $r ?: null;
    }

    private function ensureNet(string $user): void
    {
        $this->query('INSERT INTO trh_net(hub_id,telegram_user_id,accepted_at,code_version,status) VALUES (?,?,?,?,\'active\') ON DUPLICATE KEY UPDATE accepted_at=accepted_at',
            [$this->hub(), $user, $this->now(), Hub::CODE_VERSION]);
    }

    /** In the network: accepted the Code here or in the hub group; not cut off; not under a group exclusion. */
    public function canUse(string $user): bool
    {
        $member = $this->community->isMember($user);
        if (!$member && $this->net($user) === null) return false;
        if (!$member && $this->community->excludedAt($user) !== null) return false;
        return $this->level($user) !== 'disconnected';
    }

    /** Members of the hub group are the initial trust seed (they accepted the Code there). */
    private function seed(string $user): bool { return $this->community->isMember($user); }

    /**
     * disconnected (decision of people) > questioned (several independent Code-violation reports,
     * hidden automatically) > trusted (seed, or «Полезно» from several people and no fresh
     * violation) > newcomer. A reviewer's weight: 1 for the seed, 0.5 for others.
     */
    public function level(string $user): string
    {
        $net = $this->net($user);
        if ($net && $net['status'] === 'disconnected') return 'disconnected';
        $cleared = (int)($net['cleared_at'] ?? 0);
        $rows = $this->query('SELECT from_id,verdict,created_at FROM trh_reviews WHERE hub_id=? AND to_id=? AND created_at>=?',
            [$this->hub(), $user, $this->now() - self::REVIEW_WINDOW])->fetchAll();
        $violations = []; $useful = []; $recentViolation = false;
        foreach ($rows as $r) {
            $w = $this->seed($r['from_id']) ? 1.0 : 0.5;
            if ($r['verdict'] === 'violation' && (int)$r['created_at'] > $cleared) {
                $violations[$r['from_id']] = $w;
                if ((int)$r['created_at'] > $this->now() - 7776000) $recentViolation = true;
            }
            if ($r['verdict'] === 'useful') $useful[$r['from_id']] = $w;
        }
        if (array_sum($violations) >= 1.5) return 'questioned';
        if ($this->seed($user)) return 'trusted';
        return array_sum($useful) >= 2 && !$recentViolation ? 'trusted' : 'newcomer';
    }

    private function bump(string $user, string $action): void
    {
        $this->query('INSERT INTO trh_usage(hub_id,telegram_user_id,day,action,n) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE n=n+1',
            [$this->hub(), $user, (int)gmdate('Ymd', $this->now() + 10800), $action]);
    }
    private function used(string $user, string $action): int
    {
        return (int)$this->query('SELECT n FROM trh_usage WHERE hub_id=? AND telegram_user_id=? AND day=? AND action=?',
            [$this->hub(), $user, (int)gmdate('Ymd', $this->now() + 10800), $action])->fetchColumn();
    }

    // ---- Dialog state -------------------------------------------------------------------

    private function setDialog(string $user, string $state): void
    {
        $this->query('INSERT INTO trh_dialogs(hub_id,telegram_user_id,state,updated_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE state=VALUES(state),updated_at=VALUES(updated_at)',
            [$this->hub(), $user, $state, $this->now()]);
    }
    public function clearDialog(string $user): void
    {
        $this->query('DELETE FROM trh_dialogs WHERE hub_id=? AND telegram_user_id=?', [$this->hub(), $user]);
    }

    // ---- Entry points from /start -------------------------------------------------------

    public function welcome(string $chat): void
    {
        if ($this->community->excludedAt($chat) !== null || $this->level($chat) === 'disconnected') {
            $this->send($chat, 'Сеть ДАО для вас сейчас недоступна. Если считаете это ошибкой, напишите сюда — сообщение придёт организаторам.');
            return;
        }
        $this->send($chat, "Сеть ДАО Русь соединяет людей по интересам и намерениям. Имена и контакты не раскрываются, пока оба не согласятся на знакомство.\n\nПравила сети — Кодекс:\n" . Hub::CODE . "\n\nПринимаете?",
            self::buttons([[self::b('Принимаю', 'trh:n:join'), self::b('Не сейчас', 'trh:n:later')]]));
    }

    public function menu(string $chat): void
    {
        if (!$this->canUse($chat)) { $this->welcome($chat); return; }
        $this->ensureNet($chat);
        $this->send($chat, "Сеть ДАО Русь. Меню — внизу экрана, команды набирать не нужно.\n\nОставьте запись — и вас найдут те, кому это близко. Или найдите людей сами. Имена раскрываются только по согласию обоих.",
            self::keyboard());
    }

    /**
     * Sent once to someone who has just accepted the Code for the hub group: tells plainly that the
     * hub is also a network, what is stored and shown, and invites a first record. Nothing is created
     * for the person here; they are already counted through their group membership (canUse).
     */
    public function greeting(string $chat): void
    {
        $this->send($chat, "Добро пожаловать. Это не только чат: хаб «Тени Руси» строит сеть, где люди находят друг друга по делам и интересам.\n\n" .
            "Скажу прямо: сейчас нас мало, и совпадение с вашей записью маловероятно. Сеть начинает работать, когда в ней достаточно людей, " .
            "и каждая запись приближает этот момент. Оставьте её сейчас: когда появится кто-то подходящий, бот сообщит вам. " .
            "Соединит он вас только с согласия обоих.\n\n" .
            "Записи «Мне нужно» и «У меня есть» публикуются в группе с вашим именем и @username (скрыть можно кнопкой «Только при совпадении»). " .
            "«Хочу сделать» и «Интерес» видны в сети без имени.\n\n" .
            "Что мы храним: ваш Telegram ID, имя и @username, ваши записи и дату согласия с правилами. " .
            "Разговоры людей друг с другом хаб не видит и не хранит. Любую запись можно снять в «Мои записи».\n\n" .
            'Первая запись одной фразой: нажмите «Мне нужно» или «У меня есть» внизу.', self::keyboard());
    }

    /** A press on the persistent keyboard (or /find, /who, /me, /menu). Null when the text is not a menu item. */
    public function menuAction(string $user, string $text): ?string
    {
        $action = self::MENU[trim($text)] ?? null;
        if ($action === null) return null;
        if (!$this->canUse($user)) { $this->welcome($user); return 'welcome'; }
        $this->clearDialog($user);
        if ($action === 'menu') { $this->menu($user); return 'menu'; }
        return $this->handle($user, 'trh:n:' . $action, static function (string $t): void {}, null);
    }

    /**
     * One action on behalf of a person, for programs (API) and AI assistants: the same actions as the
     * buttons, named by their callback data without «trh:n:» (find, new:need, req:ID, ok:ID …).
     * For an action that waits for text (find, new:*, about, city:ID, pt:…), $text is that text.
     * Keys cannot be made or revoked this way: only in the bot. $beforeText runs between the two steps.
     */
    public function run(string $user, string $action, ?string $text, ?callable $beforeText = null): string
    {
        if (!preg_match('/^[a-z]+(:[a-z]+)?(:[a-f0-9]{32})?(:[unx123])?$/D', $action) || preg_match('/^(key|kd|kk|join|later)/', $action)) return 'unknown_action';
        if (!$this->canUse($user)) { $this->welcome($user); return 'net_denied'; }
        $this->clearDialog($user);
        if ($action === 'menu') { $this->menu($user); return 'menu'; }
        $result = $this->handle($user, 'trh:n:' . $action, static function (string $t): void {}, null);
        if ($text === null || !$this->query('SELECT 1 FROM trh_dialogs WHERE hub_id=? AND telegram_user_id=?', [$this->hub(), $user])->fetch()) {
            if ($result === 'ignored') return 'unknown_action';
            return $result;
        }
        if ($beforeText) $beforeText(); // the prompt («Напишите…») is not needed when the text is already here
        return $this->dialogInput(['from' => ['id' => $user], 'text' => $text]) ?? $result;
    }

    // ---- Keys for programs and AI assistants -----------------------------------------------

    public static function keyHash(string $key): string { return hash('sha256', $key); }

    /** The person a live key belongs to; marks the key used. Null for an unknown, revoked or idle key. */
    public function keyUser(string $key): ?string
    {
        if (!preg_match('/^dao_[A-Za-z0-9_-]{32}$/D', $key)) return null;
        $k = $this->query('SELECT telegram_user_id,created_at,last_used_at FROM trh_keys WHERE hash=? AND hub_id=? AND revoked_at IS NULL', [self::keyHash($key), $this->hub()])->fetch();
        if (!$k || (int)($k['last_used_at'] ?? $k['created_at']) + self::KEY_IDLE < $this->now()) return null;
        $this->query('UPDATE trh_keys SET last_used_at=? WHERE hash=?', [$this->now(), self::keyHash($key)]);
        return $k['telegram_user_id'];
    }

    private function liveKeys(string $user): array
    {
        return $this->query('SELECT tail,created_at,last_used_at FROM trh_keys WHERE hub_id=? AND telegram_user_id=? AND revoked_at IS NULL AND (last_used_at>? OR (last_used_at IS NULL AND created_at>?)) ORDER BY created_at',
            [$this->hub(), $user, $this->now() - self::KEY_IDLE, $this->now() - self::KEY_IDLE])->fetchAll();
    }

    /** Through the relay when it is set up (bin/set-relay.php): the hosting does not let data-center traffic in. */
    private function relayUrl(): ?string { $r = $this->config['relay_url'] ?? null; return is_string($r) && $r !== '' ? rtrim($r, '/') : null; }
    private function apiUrl(): string
    {
        return $this->relayUrl() !== null ? $this->relayUrl() . '/api' : preg_replace('#webhook\.php$#', 'api.php', (string)($this->config['webhook_url'] ?? 'https://dao.h1n.ru/webhook.php'));
    }

    private function sendKeys(string $user): void
    {
        $keys = $this->liveKeys($user);
        $lines = [];
        foreach ($keys as $i => $k) $lines[] = ($i + 1) . '. …' . $k['tail'] . ' — создан ' . Community::date((int)$k['created_at']) .
            ($k['last_used_at'] ? ', последний раз ' . Community::date((int)$k['last_used_at']) : ', ещё не использовался');
        $rows = [];
        if (count($keys) < self::KEYS_MAX) $rows[] = [self::b('Создать ключ', 'trh:n:keynew')];
        if ($keys) $rows[] = [self::b('Отключить все ключи', 'trh:n:keyoff')];
        $this->send($user, "Ключи для программ и ИИ-ассистентов: " . count($keys) . ' из ' . self::KEYS_MAX . '.' . ($lines ? "\n\n" . implode("\n", $lines) : '') .
            "\n\nКлюч позволяет программе или вашему ИИ (Claude, ChatGPT) действовать в сети от вашего имени: искать, оставлять записи, просить о знакомстве. " .
            'Видит она ровно то же, что вы в боте; чужие имена — только после согласия обоих. Просьбы и совпадения всё равно приходят сюда, в бот. ' .
            'Ключ, которым не пользовались 90 дней, гаснет сам.', $rows ? self::buttons($rows) : []);
    }

    private function newKey(string $user, callable $answer): string
    {
        if (count($this->liveKeys($user)) >= self::KEYS_MAX) { $answer('Уже ' . self::KEYS_MAX . ' ключей'); $this->send($user, 'У вас уже ' . self::KEYS_MAX . ' ключей. Отключите их в /key и создайте новый.'); return 'key_limit'; }
        $key = 'dao_' . rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
        $this->query('INSERT INTO trh_keys(hash,hub_id,telegram_user_id,tail,created_at) VALUES (?,?,?,?,?)', [self::keyHash($key), $this->hub(), $user, substr($key, -4), $this->now()]);
        $answer('Ключ создан');
        $head = "Ваш новый ключ (нажмите, чтобы скопировать):\n\n";
        $text = $head . $key;
        $entities = [['type' => 'code', 'offset' => Community::u16($head), 'length' => Community::u16($key)]];
        if ($this->relayUrl() !== null) {
            // The connector address carries the key: Claude and ChatGPT ask only for an address.
            $text .= "\n\nПодключить к своему ИИ (Claude, ChatGPT): добавьте коннектор с адресом\n";
            $mcp = $this->relayUrl() . '/mcp/' . $key;
            $entities[] = ['type' => 'code', 'offset' => Community::u16($text), 'length' => Community::u16($mcp)];
            $text .= $mcp . "\nВ адресе уже есть ключ — им тоже ни с кем не делитесь.";
        }
        $text .= "\n\nАдрес для программ: " . $this->apiUrl() .
            "\n\nНикому не показывайте ключ: с ним действуют от вашего имени. Я храню только его отпечаток, поэтому показать ещё раз не смогу. Отключить — /key.";
        $this->send($user, $text, ['entities' => $entities]);
        return 'key_created';
    }

    // ---- Callbacks ----------------------------------------------------------------------

    public function callback(array $cb): string
    {
        if (!is_string($cb['id'] ?? null) || !Hub::userId($cb['from']['id'] ?? null) || !is_string($cb['data'] ?? null)) return 'ignored';
        $data = $cb['data'];
        // Buttons of the earlier Exchange menu keep working.
        $data = preg_replace('/^trh:x:(need|have)$/', 'trh:n:new:$1', $data);
        $data = preg_replace('/^trh:x:(list|mine|del:[a-f0-9]{32})$/', 'trh:n:$1', $data);
        $user = (string)$cb['from']['id'];
        $answer = fn(string $t) => $this->bot->call('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => $t]);
        return $this->handle($user, $data, $answer, $cb);
    }

    private function handle(string $user, string $data, callable $answer, ?array $cb): string
    {
        $id = '([a-f0-9]{32})';
        if ($data === 'trh:n:join') {
            if ($this->community->excludedAt($user) !== null && !$this->community->isMember($user)) { $answer('Недоступно'); return 'net_denied'; }
            $this->ensureNet($user);
            $answer('Добро пожаловать');
            $this->menu($user);
            // First value within seconds: one question, saved as an interest, answered with similar people.
            $this->setDialog($user, 'entry:interest');
            $this->send($user, 'Что вас сейчас занимает? Напишите одной фразой — сохраню как ваш интерес и сразу покажу, кто думает о похожем. Не хотите — нажмите любую кнопку внизу.');
            return 'net_joined';
        }
        if ($data === 'trh:n:later') { $answer('Хорошо'); return 'net_later'; }
        if ($cb !== null && (preg_match("/^trh:n:kd:$id$/D", $data, $m) || preg_match("/^trh:n:kk:$id$/D", $data, $m))) return $this->operatorDecision($cb, $m[1], str_starts_with($data, 'trh:n:kd:'));
        if (!$this->canUse($user)) { $answer('Сначала войдите в сеть — нажмите /start'); return 'net_denied'; }

        if (preg_match('/^trh:n:new:(need|have|do|interest)$/D', $data, $m)) {
            $active = (int)$this->query("SELECT COUNT(*) FROM trh_signals WHERE hub_id=? AND telegram_user_id=? AND status='active'", [$this->hub(), $user])->fetchColumn();
            if ($active >= self::ACTIVE_MAX) { $answer('Слишком много записей'); $this->send($user, 'У вас уже ' . self::ACTIVE_MAX . ' записей. Снимите старые в «Мои записи» и добавьте новую.'); return 'entry_limit'; }
            $this->setDialog($user, 'entry:' . $m[1]);
            $answer('Жду ваш текст');
            $this->send($user, self::PROMPTS[$m[1]] . ' (до ' . self::BODY_MAX . ' символов). Передумали — нажмите любую кнопку внизу.');
            return 'entry_prompt';
        }
        if ($data === 'trh:n:find') {
            if ($this->level($user) === 'questioned') { $answer('Недоступно'); $this->send($user, 'Пока организаторы рассматривают жалобы, поиск для вас недоступен.'); return 'search_denied'; }
            if ($this->used($user, 'search') >= self::LIMITS['search']) { $answer('Лимит на сегодня'); $this->send($user, 'На сегодня поисков достаточно, продолжим завтра.'); return 'search_limit'; }
            $this->setDialog($user, 'search');
            $answer('Что ищете?');
            $this->send($user, 'Кого или что ищете? Напишите несколькими словами — например: «децентрализованные организации Москва».');
            return 'search_prompt';
        }
        if ($data === 'trh:n:who') { $answer('Кто здесь'); $this->who($user); return 'who'; }
        if ($data === 'trh:n:key') { $answer('Ключи'); $this->sendKeys($user); return 'keys'; }
        if ($data === 'trh:n:keynew') return $this->newKey($user, $answer);
        if ($data === 'trh:n:keyoff') {
            $n = $this->query('UPDATE trh_keys SET revoked_at=? WHERE hub_id=? AND telegram_user_id=? AND revoked_at IS NULL', [$this->now(), $this->hub(), $user])->rowCount();
            $answer('Ключи отключены');
            $this->send($user, '✓ Все ключи отключены (' . $n . '). Программы, которые ими пользовались, больше не смогут действовать от вашего имени.');
            return 'keys_revoked';
        }
        if ($data === 'trh:n:list') { $answer('Обмен'); $this->sendList($user); return 'list'; }
        if ($data === 'trh:n:mine') { $answer('Мои записи'); $this->sendMine($user); return 'mine'; }
        if ($data === 'trh:n:me') { $answer('О себе'); $this->sendMe($user); return 'me'; }
        if ($data === 'trh:n:about') {
            $this->setDialog($user, 'about');
            $answer('Жду текст');
            $this->send($user, 'Напишите строку о себе (до ' . self::ABOUT_MAX . ' символов). Её увидит тот, с кем вы соединяетесь, вместе с просьбой о знакомстве.');
            return 'about_prompt';
        }
        if ($data === 'trh:n:renew') {
            $rows = $this->query("SELECT id,kind FROM trh_signals WHERE hub_id=? AND telegram_user_id=? AND status='active'", [$this->hub(), $user])->fetchAll();
            foreach ($rows as $r) $this->query('UPDATE trh_signals SET expires_at=?,warned_at=NULL WHERE id=?', [self::expiresAt($r['kind'], $this->now()), $r['id']]);
            $answer('Продлено');
            $this->send($user, 'Записи продлены: ' . count($rows) . '. «Нужно» и «Есть» — на 90 дней, «Хочу сделать» — на полгода, интересы живут без срока.');
            return 'renewed';
        }
        if (preg_match("/^trh:n:ren:$id$/D", $data, $m)) {
            $s = $this->ownEntry($user, $m[1]);
            if (!$s) { $answer('Запись уже снята'); return 'entry_gone'; }
            $until = self::expiresAt($s['kind'], $this->now());
            $this->query('UPDATE trh_signals SET expires_at=?,warned_at=NULL WHERE id=?', [$until, $s['id']]);
            $answer('Продлено');
            $this->send($user, '✓ Запись продлена' . ($until ? ' до ' . Community::date($until) : '') . '.');
            return 'renewed_one';
        }
        if ($data === 'trh:n:notify') {
            $this->ensureNet($user);
            $on = (int)($this->net($user)['notify'] ?? 1) === 1;
            $this->query('UPDATE trh_net SET notify=? WHERE hub_id=? AND telegram_user_id=?', [$on ? 0 : 1, $this->hub(), $user]);
            $answer($on ? 'Совпадения больше не присылаю' : 'Буду присылать совпадения');
            $this->send($user, $on ? 'Хорошо, не буду присылать похожие записи. Включить снова — «О себе».' : '✓ Буду присылать похожие записи, не больше ' . self::MATCH_NOTIFY_MAX . ' в день.');
            return $on ? 'notify_off' : 'notify_on';
        }
        if (preg_match("/^trh:n:del:$id$/D", $data, $m)) return $this->archive($user, $m[1], $answer);
        if (preg_match("/^trh:n:vis:$id$/D", $data, $m)) return $this->hide($user, $m[1], $answer);
        if (preg_match("/^trh:n:city:$id$/D", $data, $m)) {
            if (!$this->ownEntry($user, $m[1])) { $answer('Запись недоступна'); return 'entry_gone'; }
            $this->setDialog($user, 'city:' . $m[1]);
            $answer('Жду город');
            $this->send($user, 'Напишите город для этой записи.');
            return 'city_prompt';
        }
        if (preg_match("/^trh:n:req:$id$/D", $data, $m)) return $this->request($user, $m[1], $answer);
        if (preg_match("/^trh:n:ok:$id$/D", $data, $m)) return $this->consent($user, $m[1], true, $answer);
        if (preg_match("/^trh:n:no:$id$/D", $data, $m)) return $this->consent($user, $m[1], false, $answer);
        if (preg_match("/^trh:n:show:$id$/D", $data, $m)) return $this->show($user, $m[1], $answer);
        if (preg_match("/^trh:n:rv:$id:(u|n|x)$/D", $data, $m)) return $this->review($user, $m[1], $m[2], null, $answer);
        if (preg_match("/^trh:n:pt:$id:(1|2|3)$/D", $data, $m)) return $this->review($user, $m[1], 'x', (int)$m[2], $answer);
        return 'ignored';
    }

    // ---- Dialog input -------------------------------------------------------------------

    /** Text the bot is waiting for. Returns null when it is not waiting for this person. */
    public function dialogInput(array $m): ?string
    {
        $user = (string)$m['from']['id'];
        $d = $this->query('SELECT state,updated_at FROM trh_dialogs WHERE hub_id=? AND telegram_user_id=?', [$this->hub(), $user])->fetch();
        if (!$d) return null;
        $text = is_string($m['text'] ?? null) ? trim($m['text']) : null;
        if ((int)$d['updated_at'] + self::DIALOG_TTL < $this->now() || !$this->canUse($user)) { $this->clearDialog($user); return null; }
        if ($text === '/skip') { $this->clearDialog($user); $this->send($user, 'Хорошо.'); return 'dialog_skipped'; }
        if ($text !== null && str_starts_with($text, '/')) { $this->clearDialog($user); return null; }
        $state = (string)$d['state'];
        if ($text === null || $text === '') { $this->send($user, 'Пожалуйста, напишите текстом.'); return 'text_required'; }
        if (str_starts_with($state, 'entry:')) return $this->saveEntry($user, substr($state, 6), $text);
        if ($state === 'search') { $this->clearDialog($user); return $this->search($user, $text); }
        if ($state === 'about') {
            if (mb_strlen($text) > self::ABOUT_MAX) { $this->send($user, 'Длиннее ' . self::ABOUT_MAX . ' символов — сократите и пришлите ещё раз.'); return 'too_long'; }
            $this->ensureNet($user);
            $this->query('UPDATE trh_net SET about=? WHERE hub_id=? AND telegram_user_id=?', [$text, $this->hub(), $user]);
            $this->clearDialog($user);
            $this->send($user, '✓ Строка о себе сохранена.');
            return 'about_saved';
        }
        if (preg_match('/^city:([a-f0-9]{32})$/D', $state, $c)) {
            if (mb_strlen($text) > self::CITY_MAX) { $this->send($user, 'Слишком длинно для города — пришлите короче.'); return 'too_long'; }
            $this->clearDialog($user);
            if (!$this->ownEntry($user, $c[1])) return 'entry_gone';
            $this->query('UPDATE trh_signals SET city=? WHERE id=?', [$text, $c[1]]);
            $this->send($user, '✓ Город указан: ' . $text . '.');
            return 'city_saved';
        }
        if (preg_match('/^note:([a-f0-9]{32})$/D', $state, $c)) {
            if (mb_strlen($text) > self::NOTE_MAX) { $this->send($user, 'Длиннее ' . self::NOTE_MAX . ' символов — сократите.'); return 'too_long'; }
            $this->query('UPDATE trh_reviews SET note=? WHERE id=? AND from_id=?', [$text, $c[1], $user]);
            $this->clearDialog($user);
            $this->send($user, 'Спасибо. Описание добавлено к отзыву; человек увидит его без вашего имени.');
            return 'note_saved';
        }
        $this->clearDialog($user);
        return null;
    }

    // ---- Records ------------------------------------------------------------------------

    private function ownEntry(string $user, string $id): ?array
    {
        $s = $this->query("SELECT * FROM trh_signals WHERE id=? AND hub_id=? AND telegram_user_id=? AND status='active'", [$id, $this->hub(), $user])->fetch();
        return $s ?: null;
    }

    private function saveEntry(string $user, string $kind, string $text): string
    {
        if (!isset(self::KINDS[$kind])) { $this->clearDialog($user); return 'entry_gone'; }
        if (mb_strlen($text) > self::BODY_MAX) { $this->send($user, 'Получилось длиннее ' . self::BODY_MAX . ' символов. Сократите и пришлите ещё раз.'); return 'too_long'; }
        $active = (int)$this->query("SELECT COUNT(*) FROM trh_signals WHERE hub_id=? AND telegram_user_id=? AND status='active'", [$this->hub(), $user])->fetchColumn();
        if ($active >= self::ACTIVE_MAX) {
            $this->clearDialog($user);
            $this->send($user, 'У вас уже ' . self::ACTIVE_MAX . ' записей. Снимите старые в «Мои записи» и добавьте новую.');
            return 'entry_limit';
        }
        $id = bin2hex(random_bytes(16));
        $this->query("INSERT INTO trh_signals(id,hub_id,telegram_user_id,kind,body,status,visibility,created_at,expires_at) VALUES (?,?,?,?,?,'active','open',?,?)",
            [$id, $this->hub(), $user, $kind, $text, $this->now(), self::expiresAt($kind, $this->now())]);
        $this->clearDialog($user);
        $posted = in_array($kind, self::GROUP_KINDS, true) && $this->community->isMember($user) && $this->postToGroup($id, $kind, $text, $user);
        $this->send($user, '✓ Запись сохранена' . ($posted ? ', видна в поиске сети и опубликована в группе.' : ' и видна в поиске сети.') .
            ' Имя не показывается, пока вы сами не согласитесь на знакомство. ' . self::lifeText($kind),
            self::buttons([[self::b('Только при совпадении', 'trh:n:vis:' . $id), self::b('Указать город', 'trh:n:city:' . $id)]]));
        $this->similar($user, ['id' => $id, 'kind' => $kind, 'body' => $text, 'city' => null]);
        return 'entry_saved';
    }

    /**
     * Right after a record is saved: show the author similar open records, and tell owners of similar
     * records (open or hidden) that a matching one appeared — at most MATCH_NOTIFY_MAX a day each,
     * never at night, never to someone who switched it off. «Similar» = at least two shared word stems
     * (or all of them, for a record of one word).
     */
    private function similar(string $user, array $entry): void
    {
        $q = self::stems($entry['body']);
        if (!$q) return;
        $need = min(2, count($q));
        $score = fn(array $r): int => count(array_intersect($q, self::stems($r['body'] . ' ' . ($r['city'] ?? ''))));
        $found = [];
        foreach ($this->liveEntries('open', $user) as $r) if (($s = $score($r)) >= $need) { $r['_s'] = $s; $found[] = $r; }
        usort($found, fn($a, $b) => [$b['_s'], $b['created_at']] <=> [$a['_s'], $a['created_at']]);
        if ($found) $this->sendResults($user, 'Похожие записи уже есть (без имён):', array_slice($found, 0, 5));
        else $this->send($user, 'Похожих записей пока нет. Когда появятся, я сообщу.');
        if ($this->quiet()) return;
        $notified = [];
        foreach (array_merge($this->liveEntries('open', $user), $this->liveEntries('match', $user)) as $r) {
            $owner = $r['telegram_user_id'];
            if (isset($notified[$owner]) || $score($r) < $need) continue;
            if ((int)($this->net($owner)['notify'] ?? 1) === 0 || $this->used($owner, 'match') >= self::MATCH_NOTIFY_MAX) continue;
            $notified[$owner] = true;
            $this->bump($owner, 'match');
            $this->send($owner, 'Появилась запись, похожая на вашу («' . mb_substr($r['body'], 0, 80) . "»):\n" . self::line($entry) .
                "\n\nПознакомиться? Имена откроются, только если согласитесь оба.",
                self::buttons([[self::b('Познакомиться', 'trh:n:req:' . $entry['id'])], [self::b('Не присылать совпадения', 'trh:n:notify')]]));
        }
    }

    private function postToGroup(string $id, string $kind, string $body, string $user): bool
    {
        $p = $this->community->person($user);
        $name = trim(($p['first_name'] ?? '') . ' ' . ($p['last_name'] ?? ''));
        if ($name === '') $name = 'участник';
        $text = self::KINDS[$kind] . "\n\n" . $body . "\n\n— ";
        $entity = ['type' => 'text_mention', 'offset' => Community::u16($text), 'length' => Community::u16($name), 'user' => ['id' => (int)$user]];
        $text .= $name . (!empty($p['username']) ? ' (@' . $p['username'] . ')' : '');
        $sent = $this->send($this->config['chat_id'], $text, ['entities' => [$entity]]);
        if (empty($sent['ok']) || !is_int($sent['result']['message_id'] ?? null)) return false;
        $this->query('UPDATE trh_signals SET group_message_id=? WHERE id=?', [$sent['result']['message_id'], $id]);
        return true;
    }

    private function unpost(array $s): void
    {
        if ($s['group_message_id'] !== null) {
            $this->bot->call('editMessageText', ['chat_id' => $this->config['chat_id'], 'message_id' => (int)$s['group_message_id'], 'text' => 'Запись снята автором.']);
        }
    }

    private function archive(string $user, string $id, callable $answer): string
    {
        $s = $this->ownEntry($user, $id);
        if (!$s) { $answer('Запись уже снята.'); return 'entry_gone'; }
        $this->query("UPDATE trh_signals SET status='archived',archived_at=? WHERE id=?", [$this->now(), $id]);
        $this->unpost($s);
        $answer('Запись снята');
        return 'entry_archived';
    }

    private function hide(string $user, string $id, callable $answer): string
    {
        $s = $this->ownEntry($user, $id);
        if (!$s) { $answer('Запись недоступна'); return 'entry_gone'; }
        $this->query("UPDATE trh_signals SET visibility='match' WHERE id=?", [$id]);
        $this->unpost($s);
        $answer('Теперь только при совпадении');
        $this->send($user, 'Запись скрыта из поиска и Обмена. Когда кто-то будет искать похожее, я спрошу вас, показать ли ему вас.');
        return 'entry_hidden';
    }

    /** Open, live records of people who may be found (not questioned or cut off). */
    private function liveEntries(string $visibility, ?string $exceptUser = null): array
    {
        $rows = $this->query("SELECT * FROM trh_signals WHERE hub_id=? AND status='active' AND visibility=? AND (kind='interest' OR expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC",
            [$this->hub(), $visibility, $this->now()])->fetchAll();
        $ok = [];
        foreach ($rows as $r) {
            if ($r['telegram_user_id'] === $exceptUser) continue;
            $owner = $r['telegram_user_id'];
            if (!isset($ok[$owner])) $ok[$owner] = $this->canUse($owner) && $this->level($owner) !== 'questioned';
            if ($ok[$owner]) $out[] = $r;
        }
        return $out ?? [];
    }

    private static function line(array $r): string
    {
        return self::KINDS[$r['kind']] . (!empty($r['city']) ? ' · ' . $r['city'] : '') . ': ' . $r['body'];
    }

    private function sendList(string $user): void
    {
        $rows = array_slice($this->liveEntries('open', $user), 0, self::LIST_MAX);
        if (!$rows) { $this->send($user, 'Открытых записей пока нет. Будьте первым — кнопки «Мне нужно», «У меня есть», «Хочу сделать» или «Интерес» внизу.'); return; }
        $this->sendResults($user, 'Обмен — свежие записи без имён (' . count($rows) . '):', $rows);
    }

    private function sendResults(string $user, string $head, array $rows): void
    {
        $lines = []; $buttons = [];
        foreach ($rows as $i => $r) {
            $lines[] = ($i + 1) . '. ' . self::line($r);
            $buttons[] = self::b('Познакомиться ' . ($i + 1), 'trh:n:req:' . $r['id']);
        }
        $this->community->sendChunks($user, $head, $lines, self::buttons(array_chunk($buttons, 2)));
    }

    private function sendMine(string $user): void
    {
        $rows = $this->query("SELECT * FROM trh_signals WHERE hub_id=? AND telegram_user_id=? AND status='active' ORDER BY created_at", [$this->hub(), $user])->fetchAll();
        if (!$rows) { $this->send($user, 'У вас нет активных записей. Добавить — кнопками внизу.'); return; }
        $lines = []; $buttons = [];
        foreach ($rows as $i => $r) {
            $endless = $r['kind'] === 'interest' || $r['expires_at'] === null;
            $expired = !$endless && (int)$r['expires_at'] <= $this->now();
            $lines[] = ($i + 1) . '. ' . self::line($r) . "\n   " . ($r['visibility'] === 'match' ? 'только при совпадении' : 'видна в поиске') .
                ($endless ? '; без срока' : ($expired ? '; срок истёк — продлите' : '; до ' . Community::date((int)$r['expires_at'])));
            $buttons[] = self::b('Снять ' . ($i + 1), 'trh:n:del:' . $r['id']);
        }
        $rowsKb = array_chunk($buttons, 5);
        $rowsKb[] = [self::b('Продлить все', 'trh:n:renew')];
        $this->community->sendChunks($user, 'Ваши записи:', $lines, self::buttons($rowsKb));
    }

    // ---- Search & «Кто здесь» -----------------------------------------------------------

    private function about(string $user): string
    {
        $a = $this->net($user)['about'] ?? null;
        return $a ? '«' . $a . '»' : 'строки о себе нет';
    }

    private function search(string $user, string $query): string
    {
        $q = self::stems($query);
        if (!$q) { $this->send($user, 'Не понял запрос. Напишите словами, кого или что ищете.'); return 'search_empty'; }
        $this->bump($user, 'search');
        $score = function (array $r) use ($q): int { return count(array_intersect($q, self::stems($r['body'] . ' ' . ($r['city'] ?? '')))); };
        $open = [];
        foreach ($this->liveEntries('open', $user) as $r) if (($s = $score($r)) > 0) { $r['_s'] = $s; $open[] = $r; }
        usort($open, fn($a, $b) => [$b['_s'], $b['created_at']] <=> [$a['_s'], $a['created_at']]);
        $open = array_slice($open, 0, self::RESULTS);
        $offered = 0;
        foreach ($this->liveEntries('match', $user) as $r) {
            if ($score($r) === 0) continue;
            $owner = $r['telegram_user_id'];
            if ($this->used($owner, 'offer') >= self::LIMITS['offer']) continue;
            if ($this->query('SELECT 1 FROM trh_links WHERE hub_id=? AND from_id=? AND entry_id=?', [$this->hub(), $user, $r['id']])->fetch()) continue;
            $link = bin2hex(random_bytes(16));
            $this->query("INSERT INTO trh_links(id,hub_id,from_id,to_id,entry_id,status,query,created_at) VALUES (?,?,?,?,?,'offered',?,?)",
                [$link, $this->hub(), $user, $owner, $r['id'], mb_substr($query, 0, 200), $this->now()]);
            $this->bump($owner, 'offer');
            $this->send($owner, "Кто-то ищет: «" . mb_substr($query, 0, 200) . "».\nЭто совпало с вашей скрытой записью: " . self::line($r) .
                "\nО себе он пишет: " . $this->about($user) . ".\n\nПоказать ему вас? Имена откроются, только если согласитесь оба.",
                self::buttons([[self::b('Показать', 'trh:n:show:' . $link), self::b('Нет', 'trh:n:no:' . $link)]]));
            $offered++;
        }
        $tail = $offered ? "\n\nЕщё " . $offered . ' чел. со скрытыми записями получили ваш запрос — если кто-то согласится, я сообщу.' : '';
        if (!$open) {
            $this->send($user, 'Открытых записей по запросу «' . $query . '» не нашлось.' . ($tail ?: ' Оставьте свою запись — тогда найдут вас.'));
            return 'search_none';
        }
        $this->sendResults($user, 'Нашлось по запросу «' . $query . '» (без имён):', $open);
        if ($tail) $this->send($user, trim($tail));
        return 'search_results';
    }

    private function who(string $user): void
    {
        $people = (int)$this->query('SELECT COUNT(*) FROM (SELECT telegram_user_id FROM trh_net WHERE hub_id=? AND status=\'active\' UNION SELECT telegram_user_id FROM trh_memberships WHERE hub_id=?) u',
            [$this->hub(), $this->hub()])->fetchColumn();
        $entries = $this->liveEntries('open');
        $stemOwners = []; $stemWords = []; $cities = []; $kinds = [];
        foreach ($entries as $r) {
            $o = $r['telegram_user_id'];
            $kinds[$r['kind']][$o] = true;
            foreach (self::words($r['body']) as $w) { $s = self::stem($w); $stemOwners[$s][$o] = true; $stemWords[$s][$w] = ($stemWords[$s][$w] ?? 0) + 1; }
            if (!empty($r['city'])) { $c = mb_convert_case(trim($r['city']), MB_CASE_TITLE); $cities[$c][$o] = true; }
        }
        $group = function (array $sets, callable $label): array {
            $out = [];
            foreach ($sets as $k => $owners) if (count($owners) >= self::MIN_GROUP) $out[$label($k)] = count($owners);
            arsort($out);
            return array_slice($out, 0, 10, true);
        };
        $fmt = fn(array $g) => $g ? implode(', ', array_map(fn($k, $n) => "$k ($n)", array_keys($g), $g)) : 'пока нет групп от ' . self::MIN_GROUP . ' человек';
        $topics = $group($stemOwners, function ($s) use ($stemWords) { arsort($stemWords[$s]); return (string)array_key_first($stemWords[$s]); });
        $kindLine = [];
        foreach (self::KINDS as $k => $label) $kindLine[] = $label . ': ' . (count($kinds[$k] ?? []) >= self::MIN_GROUP ? count($kinds[$k]) : 'меньше ' . self::MIN_GROUP);
        $this->send($user, "Кто здесь\n\nВ сети: " . $people . ' чел.' .
            "\nОткрытых записей: " . count($entries) . "\n" . implode("\n", $kindLine) .
            "\n\nЧаще всего пишут о: " . $fmt($topics) .
            "\nГорода: " . $fmt($group($cities, fn($c) => (string)$c)) .
            "\n\nПоказаны только группы от " . self::MIN_GROUP . ' человек и только открытые записи — по сводке нельзя узнать конкретного человека.');
    }

    // ---- Connections ---------------------------------------------------------------------

    private function link(string $id): ?array
    {
        $l = $this->query('SELECT * FROM trh_links WHERE id=? AND hub_id=?', [$id, $this->hub()])->fetch();
        return $l ?: null;
    }

    private function request(string $user, string $entryId, callable $answer): string
    {
        $level = $this->level($user);
        if ($level === 'questioned') { $answer('Недоступно'); return 'request_denied'; }
        $e = $this->query("SELECT * FROM trh_signals WHERE id=? AND hub_id=? AND status='active'", [$entryId, $this->hub()])->fetch();
        if (!$e || ($e['expires_at'] !== null && (int)$e['expires_at'] <= $this->now()) || !$this->canUse($e['telegram_user_id'])) { $answer('Запись уже недоступна'); return 'entry_gone'; }
        if ($e['telegram_user_id'] === $user) { $answer('Это ваша запись'); return 'own_entry'; }
        if ($e['visibility'] !== 'open') { $answer('Запись недоступна'); return 'entry_gone'; }
        if ($this->query('SELECT 1 FROM trh_links WHERE hub_id=? AND from_id=? AND entry_id=?', [$this->hub(), $user, $entryId])->fetch()) { $answer('Вы уже просили'); return 'request_repeat'; }
        $limit = self::LIMITS['request'][$level === 'trusted' ? 'trusted' : 'newcomer'];
        if ($this->used($user, 'request') >= $limit) { $answer('Лимит на сегодня'); $this->send($user, 'На сегодня просьб о знакомстве достаточно (' . $limit . '). Продолжим завтра.'); return 'request_limit'; }
        $link = bin2hex(random_bytes(16));
        $this->query("INSERT INTO trh_links(id,hub_id,from_id,to_id,entry_id,status,created_at) VALUES (?,?,?,?,?,'requested',?)",
            [$link, $this->hub(), $user, $e['telegram_user_id'], $entryId, $this->now()]);
        $this->bump($user, 'request');
        $trusted = $level === 'trusted' ? "\nОтметка сети: можно доверять." : '';
        $this->send($e['telegram_user_id'], "Просьба о знакомстве по вашей записи: " . self::line($e) . "\nО себе он пишет: " . $this->about($user) . '.' . $trusted .
            "\n\nСоединить? Имена откроются, только если согласитесь.",
            self::buttons([[self::b('Соединить', 'trh:n:ok:' . $link), self::b('Отказать', 'trh:n:no:' . $link)]]));
        $answer('Просьба отправлена');
        $this->send($user, 'Просьба отправлена. Если человек согласится, я пришлю вам ссылку на него.');
        return 'requested';
    }

    /** Hidden record: the owner agrees to be shown to the seeker, who then decides. */
    private function show(string $user, string $linkId, callable $answer): string
    {
        $l = $this->link($linkId);
        if (!$l || $l['to_id'] !== $user || $l['status'] !== 'offered') { $answer('Уже неактуально'); return 'link_stale'; }
        $e = $this->query('SELECT * FROM trh_signals WHERE id=?', [$l['entry_id']])->fetch();
        $this->query("UPDATE trh_links SET status='shown',decided_at=? WHERE id=?", [$this->now(), $linkId]);
        $answer('Предложено');
        $this->send($l['from_id'], "По вашему запросу «" . $l['query'] . "» нашёлся человек: " . ($e ? self::line($e) : '') .
            "\nО себе он пишет: " . $this->about($user) . ".\n\nПознакомиться? Имена откроются, только если согласитесь.",
            self::buttons([[self::b('Познакомиться', 'trh:n:ok:' . $linkId), self::b('Не нужно', 'trh:n:no:' . $linkId)]]));
        return 'shown';
    }

    private function consent(string $user, string $linkId, bool $yes, callable $answer): string
    {
        $l = $this->link($linkId);
        if (!$l) { $answer('Уже неактуально'); return 'link_stale'; }
        $decider = match ($l['status']) { 'requested', 'offered' => $l['to_id'], 'shown' => $l['from_id'], default => null };
        if ($decider !== $user) { $answer('Уже неактуально'); return 'link_stale'; }
        if (!$yes) {
            $this->query("UPDATE trh_links SET status='declined',decided_at=? WHERE id=?", [$this->now(), $linkId]);
            $answer('Хорошо');
            if ($l['status'] === 'requested') $this->send($l['from_id'], 'Человек пока не готов к знакомству. Это нормально — попробуйте другие записи.');
            return 'declined';
        }
        if ($l['status'] === 'offered') return $this->show($user, $linkId, $answer);
        if (!$this->canUse($l['from_id']) || !$this->canUse($l['to_id'])) { $answer('Соединение недоступно'); return 'link_stale'; }
        $this->query("UPDATE trh_links SET status='connected',decided_at=?,connected_at=? WHERE id=?", [$this->now(), $this->now(), $linkId]);
        $answer('Соединено');
        $e = $this->query('SELECT * FROM trh_signals WHERE id=?', [$l['entry_id']])->fetch();
        $this->introduce($l['from_id'], $l['to_id'], $e);
        $this->introduce($l['to_id'], $l['from_id'], $e);
        return 'connected';
    }

    /** Tells $to who the other person is: a name linked to the profile by ID (works without @username). */
    private function introduce(string $to, string $other, $entry): void
    {
        $p = $this->community->person($other);
        $name = trim(($p['first_name'] ?? '') . ' ' . ($p['last_name'] ?? ''));
        if ($name === '') $name = 'собеседник';
        $text = 'Знакомство состоялось' . ($entry ? ' по записи: ' . self::line($entry) : '') . "\n\nВаш собеседник: ";
        $entity = ['type' => 'text_mention', 'offset' => Community::u16($text), 'length' => Community::u16($name), 'user' => ['id' => (int)$other]];
        $text .= $name . (!empty($p['username']) ? ' (@' . $p['username'] . ')' : '') .
            "\nНажмите на имя, чтобы открыть профиль и написать. Через неделю я спрошу, как прошло общение.";
        $this->send($to, $text, ['entities' => [$entity]]);
    }

    // ---- Reviews & trust -----------------------------------------------------------------

    /** Worker: a week after a connection, ask each side once. */
    public function tick(bool $quiet): void
    {
        if ($quiet || $this->quiet()) return;
        // A week before a record goes out, its author is asked once whether to keep it.
        $ending = $this->query("SELECT * FROM trh_signals WHERE hub_id=? AND status='active' AND kind<>'interest' AND warned_at IS NULL AND expires_at IS NOT NULL AND expires_at>? AND expires_at<=? ORDER BY expires_at LIMIT 20",
            [$this->hub(), $this->now(), $this->now() + self::WARN_BEFORE])->fetchAll();
        foreach ($ending as $s) {
            $this->query('UPDATE trh_signals SET warned_at=? WHERE id=?', [$this->now(), $s['id']]);
            $this->send($s['telegram_user_id'], 'Ваша запись погаснет ' . Community::date((int)$s['expires_at']) . ":\n" . self::line($s) . "\n\nПродлить?",
                self::buttons([[self::b('Продлить', 'trh:n:ren:' . $s['id']), self::b('Снять', 'trh:n:del:' . $s['id'])]]));
        }
        $rows = $this->query("SELECT * FROM trh_links WHERE hub_id=? AND status='connected' AND connected_at<=? AND (asked_from=0 OR asked_to=0) ORDER BY connected_at LIMIT 20",
            [$this->hub(), $this->now() - self::REVIEW_AFTER])->fetchAll();
        foreach ($rows as $l) {
            foreach ([['asked_from', $l['from_id'], $l['to_id']], ['asked_to', $l['to_id'], $l['from_id']]] as [$col, $who, $other]) {
                if ((int)$l[$col] !== 0) continue;
                $this->query("UPDATE trh_links SET $col=1 WHERE id=?", [$l['id']]);
                $p = $this->community->person($other);
                $this->send($who, 'Неделю назад вы познакомились с ' . trim(($p['first_name'] ?? 'собеседником') . ' ' . ($p['last_name'] ?? '')) .
                    ". Как прошло общение?\n\nОтзыв касается только поведения в общении, не взглядов человека.",
                    self::buttons([[self::b('Полезно', 'trh:n:rv:' . $l['id'] . ':u'), self::b('Нейтрально', 'trh:n:rv:' . $l['id'] . ':n')],
                        [self::b('Нарушил Кодекс', 'trh:n:rv:' . $l['id'] . ':x')]]));
            }
        }
    }

    private function review(string $user, string $linkId, string $verdict, ?int $point, callable $answer): string
    {
        $l = $this->link($linkId);
        if (!$l || $l['status'] !== 'connected' || !in_array($user, [$l['from_id'], $l['to_id']], true)) { $answer('Отзыв недоступен'); return 'review_denied'; }
        $target = $user === $l['from_id'] ? $l['to_id'] : $l['from_id'];
        if ($this->query('SELECT 1 FROM trh_reviews WHERE link_id=? AND from_id=?', [$linkId, $user])->fetch()) { $answer('Отзыв уже есть'); return 'review_repeat'; }
        if ($verdict === 'x' && $point === null) {
            $answer('Какой пункт?');
            $this->send($user, 'Какой пункт Кодекса нарушен?', self::buttons([
                [self::b('1. Напал первым', 'trh:n:pt:' . $linkId . ':1')],
                [self::b('2. Не уважал чужую свободу', 'trh:n:pt:' . $linkId . ':2')],
                [self::b('3. Против народовластия', 'trh:n:pt:' . $linkId . ':3')]]));
            return 'review_point';
        }
        $before = $this->level($target);
        $id = bin2hex(random_bytes(16));
        $this->query('INSERT INTO trh_reviews(id,hub_id,link_id,from_id,to_id,verdict,code_point,created_at) VALUES (?,?,?,?,?,?,?,?)',
            [$id, $this->hub(), $linkId, $user, $target, ['u' => 'useful', 'n' => 'neutral', 'x' => 'violation'][$verdict], $point, $this->now()]);
        $answer('Спасибо за отзыв');
        if ($verdict !== 'x') return 'reviewed';
        $this->setDialog($user, 'note:' . $id);
        $this->send($user, 'Опишите в паре слов, что случилось. Это увидит сам человек — без вашего имени. Или напишите /skip.');
        if ($before !== 'questioned' && $this->level($target) === 'questioned') {
            $this->send($target, 'Несколько участников сообщили о нарушении Кодекса в общении с вами. Пока вы скрыты из поиска; решение примут организаторы. Отзывы — кнопка «О себе». Ответить можно, написав сюда.');
            $points = $this->query("SELECT code_point FROM trh_reviews WHERE hub_id=? AND to_id=? AND verdict='violation' AND created_at>=?",
                [$this->hub(), $target, $this->now() - self::REVIEW_WINDOW])->fetchAll(PDO::FETCH_COLUMN);
            $this->community->notifyOperator(Community::displayName($this->community->person($target)) .
                ' скрыт из поиска сети: жалобы на нарушение Кодекса (пункты: ' . implode(', ', array_map('intval', $points)) . "). Решение за людьми.",
                self::buttons([[self::b('Отключить от сети', 'trh:n:kd:' . $id), self::b('Оставить', 'trh:n:kk:' . $id)]]));
        }
        return 'reviewed';
    }

    private function operatorDecision(array $cb, string $reviewId, bool $disconnect): string
    {
        if (($cb['from']['id'] ?? null) !== $this->operator()) return 'ignored';
        $r = $this->query('SELECT * FROM trh_reviews WHERE id=? AND hub_id=?', [$reviewId, $this->hub()])->fetch();
        if (!$r) { $this->bot->call('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => 'Не найдено']); return 'decision_stale'; }
        $target = $r['to_id'];
        $this->ensureNet($target);
        if ($disconnect) {
            $this->query("UPDATE trh_net SET status='disconnected' WHERE hub_id=? AND telegram_user_id=?", [$this->hub(), $target]);
            $this->send($target, 'Решением организаторов вы отключены от сети ДАО. Оспорить решение можно, написав сюда — сообщение придёт организаторам.');
        } else {
            $this->query("UPDATE trh_net SET status='active',cleared_at=? WHERE hub_id=? AND telegram_user_id=?", [$this->now(), $this->hub(), $target]);
            $this->send($target, 'Организаторы рассмотрели жалобы и оставили вас в сети. Вы снова видны в поиске.');
        }
        $this->bot->call('answerCallbackQuery', ['callback_query_id' => $cb['id'], 'text' => $disconnect ? 'Отключён' : 'Оставлен']);
        if (is_int($cb['message']['message_id'] ?? null)) {
            $this->bot->call('editMessageText', ['chat_id' => $this->operator(), 'message_id' => $cb['message']['message_id'],
                'text' => (is_string($cb['message']['text'] ?? null) ? $cb['message']['text'] : 'Решение по жалобам') . "\n\nРешение: " . ($disconnect ? 'отключён от сети.' : 'оставлен в сети.')]);
        }
        return $disconnect ? 'disconnected' : 'cleared';
    }

    private function sendMe(string $user): void
    {
        $level = $this->level($user);
        $levelText = ['trusted' => 'можно доверять', 'newcomer' => 'новичок', 'questioned' => 'скрыт из поиска до решения организаторов', 'disconnected' => 'отключён'][$level];
        $links = (int)$this->query("SELECT COUNT(*) FROM trh_links WHERE hub_id=? AND status='connected' AND (from_id=? OR to_id=?)", [$this->hub(), $user, $user])->fetchColumn();
        $reviews = $this->query('SELECT verdict,code_point,note,created_at FROM trh_reviews WHERE hub_id=? AND to_id=? ORDER BY created_at', [$this->hub(), $user])->fetchAll();
        $count = ['useful' => 0, 'neutral' => 0, 'violation' => 0];
        $notes = [];
        foreach ($reviews as $r) {
            $count[$r['verdict']]++;
            if ($r['verdict'] === 'violation') $notes[] = Community::date((int)$r['created_at']) . ' — п. ' . (int)$r['code_point'] . ' (' . (self::CODE_POINTS[(int)$r['code_point']] ?? '?') . ')' .
                ($r['note'] ? ': «' . $r['note'] . '»' : '');
        }
        $text = "О себе\n\nУровень доверия: " . $levelText . "\nЗнакомств: " . $links .
            "\nОтзывы: «Полезно» — " . $count['useful'] . ', «Нейтрально» — ' . $count['neutral'] . ', «Нарушил Кодекс» — ' . $count['violation'] .
            ($notes ? "\n\nЖалобы (без имён авторов):\n" . implode("\n", $notes) : '') .
            "\n\nСтрока о себе: " . $this->about($user) . "\nЕё видит тот, кого вы просите о знакомстве или кто просит вас." .
            "\n\nПохожие записи: " . ((int)($this->net($user)['notify'] ?? 1) === 1 ? 'присылаю, не больше ' . self::MATCH_NOTIFY_MAX . ' в день' : 'не присылаю') . '.';
        $notify = (int)($this->net($user)['notify'] ?? 1) === 1;
        $this->send($user, $text, self::buttons([[self::b('Изменить строку о себе', 'trh:n:about')],
            [self::b($notify ? 'Не присылать совпадения' : 'Присылать совпадения', 'trh:n:notify')], [self::b('Ключи для программ и ИИ', 'trh:n:key')]]));
    }
}
