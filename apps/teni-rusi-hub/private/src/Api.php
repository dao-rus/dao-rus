<?php
declare(strict_types=1);
namespace TeniRusi;

use PDO;

/**
 * Step 2 of the switchboard protocol: the same network for programs and AI assistants.
 * POST JSON {"action": "...", "text": "..."} with «Authorization: Bearer KEY» (key from /key in the bot).
 * Actions are exactly the bot's buttons; the answer is what the bot would have said to this person,
 * with the next possible actions attached. Messages for other people (requests, matches) still go
 * through the bot, so nobody is reached by anything the bot itself would not send.
 */
final class Api
{
    public const VERSION = '0.1';
    public const DAILY_MAX = 600;     // calls per person per day, on top of the network's own limits
    public const TEXT_MAX = 1000;

    private $clock;

    public function __construct(private ?PDO $db, private Bot $bot, private array $config, ?callable $clock = null)
    {
        $this->clock = $clock ?? static fn(): int => time();
    }

    /** @return array{0:int,1:array} HTTP status and JSON body. */
    public function handle(string $method, string $auth, string $body): array
    {
        if ($method === 'GET') return [200, self::help($this->config)];
        if ($method !== 'POST' || $this->db === null) return [405, ['ok' => false, 'error' => 'method']];
        if (strlen($body) > 16384) return [413, ['ok' => false, 'error' => 'too_large']];
        try { $in = json_decode($body === '' ? '{}' : $body, true, 8, JSON_THROW_ON_ERROR); }
        catch (\JsonException $e) { return [400, ['ok' => false, 'error' => 'json']]; }
        if (!is_array($in)) return [400, ['ok' => false, 'error' => 'json']];
        $key = preg_match('/^Bearer\s+(\S+)$/i', trim($auth), $m) ? $m[1] : (is_string($in['key'] ?? null) ? $in['key'] : '');
        $action = $in['action'] ?? 'menu';
        $text = $in['text'] ?? null;
        if (!is_string($action) || ($text !== null && !is_string($text))) return [400, ['ok' => false, 'error' => 'fields']];
        if ($text !== null && mb_strlen($text) > self::TEXT_MAX) return [400, ['ok' => false, 'error' => 'text_too_long']];

        $now = ($this->clock)();
        $capture = new CaptureBot($this->bot);
        $community = new Community($this->db, $capture, $this->config, $this->clock);
        $network = new Network($this->db, $capture, $this->config, $this->clock, $community);
        $user = $network->keyUser($key);
        if ($user === null) return [401, ['ok' => false, 'error' => 'key', 'hint' => 'Ключ не найден, отключён или не использовался 90 дней. Новый — команда /key в боте @Daorus_bot.']];
        $day = (int)gmdate('Ymd', $now + 10800);
        $this->db->prepare('INSERT INTO trh_usage(hub_id,telegram_user_id,day,action,n) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE n=n+1')->execute([$this->config['hub_id'], $user, $day, 'api']);
        $q = $this->db->prepare('SELECT n FROM trh_usage WHERE hub_id=? AND telegram_user_id=? AND day=? AND action=?');
        $q->execute([$this->config['hub_id'], $user, $day, 'api']);
        if ((int)$q->fetchColumn() > self::DAILY_MAX) return [429, ['ok' => false, 'error' => 'daily_limit']];

        $capture->user = $user;
        $result = $network->run($user, trim($action), $text === null ? null : trim($text), function () use ($capture): void { $capture->messages = []; });
        return [200, ['ok' => true, 'result' => $result, 'messages' => $capture->messages]];
    }

    public static function help(array $config): array
    {
        return [
            'ok' => true,
            'name' => 'Коммутатор ДАО Русь',
            'version' => self::VERSION,
            'how' => 'POST JSON {"action": "...", "text": "..."} с заголовком «Authorization: Bearer КЛЮЧ». Ключ выдаёт команда /key в Telegram-боте @Daorus_bot. ' .
                'Ответ — то, что бот сказал бы этому человеку, и список следующих возможных действий (actions). Имена других людей появляются только после согласия обоих.',
            'actions' => [
                'menu' => 'меню и правила',
                'find' => 'поиск людей и записей; text — слова',
                'new:need | new:have | new:do | new:interest' => 'оставить запись «Нужно» / «Есть» / «Хочу сделать» / «Интерес»; text — сама запись',
                'who' => 'кто здесь: сводка без имён',
                'list' => 'свежие открытые записи',
                'mine' => 'мои записи',
                'me' => 'о себе: доверие, отзывы, настройки',
                'about' => 'строка о себе; text — строка',
                'req:ID' => 'попросить о знакомстве по записи',
                'ok:ID | no:ID | show:ID' => 'ответить на просьбу о знакомстве',
                'del:ID | vis:ID | ren:ID | city:ID' => 'снять / скрыть / продлить запись, указать город (text)',
                'renew | notify' => 'продлить все записи / включить-выключить совпадения',
                'rv:ID:u|n|x, pt:ID:1|2|3' => 'отзыв о знакомстве',
            ],
            'notifications' => 'Просьбы о знакомстве и совпадения приходят человеку в бот.',
        ];
    }
}

/** Passes everything to Telegram except messages to the API caller, which become the API answer. */
final class CaptureBot implements Bot
{
    public ?string $user = null;
    public array $messages = [];

    public function __construct(private Bot $bot) {}

    public function call(string $method, array $params): array
    {
        if ($method === 'answerCallbackQuery') return ['ok' => true, 'result' => true];
        if ($this->user !== null && in_array($method, ['sendMessage', 'editMessageText'], true) && (string)($params['chat_id'] ?? '') === $this->user) {
            $this->messages[] = self::message($params);
            return ['ok' => true, 'result' => ['message_id' => 0]];
        }
        return $this->bot->call($method, $params);
    }

    private static function message(array $p): array
    {
        $out = ['text' => (string)($p['text'] ?? '')];
        $actions = [];
        foreach ($p['reply_markup']['inline_keyboard'] ?? [] as $row) foreach ($row as $b) {
            if (str_starts_with($b['callback_data'] ?? '', 'trh:n:')) $actions[] = ['label' => $b['text'], 'action' => substr($b['callback_data'], 6)];
        }
        foreach ($p['reply_markup']['keyboard'] ?? [] as $row) foreach ($row as $b) {
            $a = Network::MENU[$b['text'] ?? ''] ?? null;
            if ($a !== null) $actions[] = ['label' => $b['text'], 'action' => $a];
        }
        if ($actions) $out['actions'] = $actions;
        // After mutual consent the bot links the other person's name to their profile by ID.
        foreach ($p['entities'] ?? [] as $e) {
            if (($e['type'] ?? '') === 'text_mention' && isset($e['user']['id'])) {
                $out['contacts'][] = ['name' => self::slice($out['text'], (int)$e['offset'], (int)$e['length']), 'telegram' => 'tg://user?id=' . (int)$e['user']['id']];
            }
        }
        return $out;
    }

    /** Substring by UTF-16 offsets, as Telegram counts them. */
    private static function slice(string $text, int $offset, int $length): string
    {
        $u = mb_convert_encoding($text, 'UTF-16LE', 'UTF-8');
        return mb_convert_encoding(substr($u, $offset * 2, $length * 2), 'UTF-8', 'UTF-16LE');
    }
}
