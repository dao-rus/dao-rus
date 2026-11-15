<?php
declare(strict_types=1);
// Applies one migration file: php82 bin/migrate.php migrations/NAME.sql
// Skips ADD COLUMN for columns that already exist, so it is safe to run again.
// Prints only what it did. CLI only.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/src/Bootstrap.php';
$name = $argv[1] ?? '';
$file = dirname(__DIR__) . '/' . $name;
if (!preg_match('#^migrations/[0-9a-z-]+\.sql$#D', $name) || !is_file($file)) { fwrite(STDERR, "Usage: bin/migrate.php migrations/NAME.sql\n"); exit(2); }
try {
    $db = \TeniRusi\database(\TeniRusi\configuration());
    $column = fn(string $t, string $c) => (bool)$db->query("SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=" . $db->quote($t) . " AND column_name=" . $db->quote($c))->fetch();
    foreach (array_filter(array_map('trim', explode(';', preg_replace('/^--.*$/m', '', file_get_contents($file))))) as $stmt) {
        if (preg_match('/^ALTER TABLE (\w+) ADD COLUMN (\w+)/', $stmt, $m) && $column($m[1], $m[2])) { echo "skip: {$m[1]}.{$m[2]} exists\n"; continue; }
        $n = $db->exec($stmt);
        echo 'ok: ' . strtok($stmt, "(\n") . (str_starts_with($stmt, 'UPDATE') ? " ($n rows)" : '') . "\n";
    }
    echo "done\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Stopped: ' . $e->getMessage() . "\n");
    exit(1);
}
