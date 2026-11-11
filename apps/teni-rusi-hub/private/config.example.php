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
];
