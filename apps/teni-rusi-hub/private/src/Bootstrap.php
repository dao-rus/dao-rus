<?php
declare(strict_types=1);
namespace TeniRusi;

require_once __DIR__ . '/Telegram.php';
require_once __DIR__ . '/Hub.php';
require_once __DIR__ . '/Webhook.php';

function configuration(): array
{
    $file = dirname(__DIR__) . '/config.php';
    if (!is_file($file)) throw new \RuntimeException('Private config.php is required');
    $c = require $file;
    if (!is_array($c) || !preg_match('/^[a-z0-9][a-z0-9_-]{1,63}$/D', $c['hub_id'] ?? '') ||
        !preg_match('/^-[1-9][0-9]{1,15}$/D', $c['chat_id'] ?? '') ||
        // response_seconds: 0 = no deadline (request stays open), otherwise 60 seconds .. 30 days.
        !is_int($c['response_seconds'] ?? null) || ($c['response_seconds'] !== 0 && ($c['response_seconds'] < 60 || $c['response_seconds'] > 2592000)) ||
        !is_string($c['title'] ?? null) || $c['title'] === '' ||
        !str_starts_with($c['database']['dsn'] ?? '', 'mysql:')) throw new \RuntimeException('Invalid private configuration');
    if (PHP_INT_SIZE !== 8) throw new \RuntimeException('64-bit PHP required');
    return $c;
}

function activationReady(array $c): bool
{
    return ($c['enabled'] ?? false) === true && ($c['exclusive_bot_confirmed'] ?? false) === true &&
        preg_match('/^[1-9][0-9]*:[A-Za-z0-9_-]+$/D', $c['bot_token'] ?? '') === 1 &&
        preg_match('/^[1-9][0-9]*$/D', $c['expected_bot_id'] ?? '') === 1 &&
        explode(':', $c['bot_token'])[0] === $c['expected_bot_id'] &&
        filter_var($c['webhook_url'] ?? '', FILTER_VALIDATE_URL) !== false &&
        parse_url($c['webhook_url'], PHP_URL_SCHEME) === 'https' &&
        parse_url($c['webhook_url'], PHP_URL_USER) === null &&
        parse_url($c['webhook_url'], PHP_URL_QUERY) === null &&
        preg_match('/^[A-Za-z0-9_-]{32,256}$/D', $c['webhook_secret'] ?? '') === 1;
}

function database(array $c): \PDO
{
    $d = $c['database'];
    $pdo = new \PDO($d['dsn'], $d['user'], $d['password'], [
        \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
        \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
        \PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    // Avoid range/gap locks in the bounded worker scan; each identity uses its own row lock.
    $pdo->exec('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
    $pdo->exec("SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'");
    $pdo->exec('SET SESSION innodb_lock_wait_timeout=15');
    return $pdo;
}
