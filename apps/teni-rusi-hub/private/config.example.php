<?php
declare(strict_types=1);

// Copy to config.php OUTSIDE the web document root. Never commit real values.
return [
    'enabled' => false,
    // Set true ONLY after an intentional temporary webhook handover of the existing Reception bot.
    // Other Reception functions will be unavailable until they are routed elsewhere.
    'exclusive_bot_confirmed' => false,
    'bot_token' => '',
    'expected_bot_id' => '',
    'webhook_secret' => '', // 32+ random A-Z a-z 0-9 _ - characters
    'webhook_url' => 'https://dao.h1n.ru/webhook.php', // Future HTTPS URL ending /webhook.php; not set automatically
    'database' => [
        'dsn' => 'mysql:host=localhost;dbname=teni_rusi;charset=utf8mb4',
        'user' => 'tenerus',
        'password' => '',
    ],
    'hub_id' => 'teni-rusi',
    'chat_id' => '-1003969604796',
    'title' => 'Хаб Тени Руси — ДАО Русь',
    'response_seconds' => 86400,
    // Telegram user ID (integer) who receives every other private message sent to the bot.
    // That person must have pressed Start in the bot. Set with bin/set-operator.php.
    'operator_chat_id' => null,
    // Closed channel (the departure list of the DAO) where the bot adds one line for everyone who leaves the group.
    // The number (-100...), not the @name. The bot must be its administrator with the right to post. Set with bin/set-departure-channel.php.
    'departure_channel_id' => null,
    // Other chats with their own reputation counter and departure list (no join flow, no votes).
    // Add with bin/set-extra-group.php <key> <chat_id> <title>. Example entry:
    // ['key' => 'dao', 'hub_id' => 'teni-rusi-dao', 'chat_id' => '-1001234567890', 'title' => 'Чат ДАО', 'left_label' => 'Покинул чат'],
    'extra_groups' => [],
];
