<?php
declare(strict_types=1);
// Applies migrations/2026-11-16-switchboard.sql, skipping what already exists, so it is
// safe to run again. Prints only what it did. CLI only.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';
try {
    $db = \TeniRusi\database(\TeniRusi\configuration());
    $column = fn(string $t, string $c) => (bool)$db->query("SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=" . $db->quote($t) . " AND column_name=" . $db->quote($c))->fetch();
    $type = fn(string $t, string $c) => (string)$db->query("SELECT COLUMN_TYPE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=" . $db->quote($t) . " AND column_name=" . $db->quote($c))->fetchColumn();
    $sql = file_get_contents(dirname(__DIR__) . '/migrations/2026-11-16-switchboard.sql');
    foreach (array_filter(array_map('trim', explode(';', preg_replace('/^--.*$/m', '', $sql)))) as $stmt) {
        if (preg_match('/^ALTER TABLE (\w+) ADD COLUMN (\w+)/', $stmt, $m) && $column($m[1], $m[2])) { echo "skip: {$m[1]}.{$m[2]} exists\n"; continue; }
        if (preg_match("/^ALTER TABLE trh_signals MODIFY kind/", $stmt) && str_contains($type('trh_signals', 'kind'), "'interest'")) { echo "skip: trh_signals.kind already extended\n"; continue; }
        if (preg_match("/^ALTER TABLE trh_dialogs MODIFY state/", $stmt) && str_starts_with($type('trh_dialogs', 'state'), 'varchar')) { echo "skip: trh_dialogs.state already varchar\n"; continue; }
        $n = $db->exec($stmt);
        echo 'ok: ' . strtok($stmt, "(\n") . (str_starts_with($stmt, 'UPDATE') ? " ($n rows)" : '') . "\n";
    }
    echo "done\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Stopped: ' . $e->getMessage() . "\n");
    exit(1);
}
