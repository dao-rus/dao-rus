import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function projectFile(name: string): Promise<string> {
  return readFile(new URL(`../../${name}`, import.meta.url), "utf8");
}

function serviceBlock(compose: string, name: string, nextName?: string): string {
  const start = compose.indexOf(`  ${name}:`);
  const end = nextName ? compose.indexOf(`  ${nextName}:`, start + 1) : compose.indexOf("\nnetworks:", start);
  return compose.slice(start, end);
}

describe("production deployment", () => {
  it("builds and runs the standalone Next.js production server", async () => {
    const dockerfile = await projectFile("Dockerfile.prod");

    expect(dockerfile).toContain("RUN npm run build");
    expect(dockerfile).toContain('ENV NODE_ENV=production');
    expect(dockerfile).toContain('CMD ["node", "server.js"]');
    expect(dockerfile).not.toContain("npm run dev");
    expect(dockerfile).toContain("COPY --chown=nextjs:nodejs migrations ./migrations");
  });

  it("packages the runtime dependencies of the Telegram roster importer", async () => {
    const dockerfile = await projectFile("Dockerfile.prod");
    const importer = await projectFile("scripts/import-telegram-roster.ts");

    expect(importer).toContain('../src/lib/telegram-roster');
    expect(importer).toContain('../src/lib/db');
    expect(dockerfile).toContain("COPY --chown=nextjs:nodejs src/lib ./src/lib");
  });

  it("packages a separate notification worker with delivery disabled by default", async () => {
    const dockerfile = await projectFile("Dockerfile.prod");
    const compose = await projectFile("compose.prod.yml");
    const worker = serviceBlock(compose, "notification-worker", "caddy");
    const packageJson = await projectFile("package.json");

    expect(dockerfile).toContain("COPY --chown=nextjs:nodejs src/lib ./src/lib");
    expect(packageJson).toContain('"notifications:worker": "node --import tsx scripts/notification-worker.ts"');
    expect(worker).toContain('command: ["node", "--import", "tsx", "scripts/notification-worker.ts"]');
    expect(worker).toContain("- backend");
    expect(worker).toContain("- worker-egress");
    expect(compose).toMatch(/\n  worker-egress:\s*(?:\r?\n|$)/);
    expect(worker).not.toContain("ports:");
    expect(compose).toContain("TELEGRAM_NOTIFICATIONS_ENABLED: ${TELEGRAM_NOTIFICATIONS_ENABLED:-false}");
  });

  it("publishes only Caddy while keeping PostgreSQL on the internal network", async () => {
    const compose = await projectFile("compose.prod.yml");
    const db = serviceBlock(compose, "db", "migrate");
    const web = serviceBlock(compose, "web", "caddy");
    const caddy = serviceBlock(compose, "caddy");

    expect(db).not.toContain("ports:");
    expect(web).not.toContain("ports:");
    expect(db).toContain("- backend");
    expect(db).not.toContain("worker-egress");
    expect(compose).toMatch(/backend:\s*\r?\n\s+internal: true/);
    expect(caddy).toContain('- "80:80"');
    expect(caddy).toContain('- "443:443"');
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain('command: ["npm", "run", "db:migrate"]');
  });

  it("keeps production secrets outside Git and fixes the public origins", async () => {
    const gitignore = await projectFile(".gitignore");
    const environment = await projectFile(".env.production.example");
    const caddy = await projectFile("Caddyfile");
    const compose = await projectFile("compose.prod.yml");

    expect(gitignore).toContain(".env.production");
    expect(environment).toContain("APP_BASE_URL=https://core.daorus.org");
    expect(environment).toContain(
      "TELEGRAM_OIDC_REDIRECT_URI=https://core.daorus.org/api/auth/telegram/callback",
    );
    expect(environment).not.toMatch(/TELEGRAM_OIDC_CLIENT_SECRET=\S+/);
    expect(environment).toContain("TELEGRAM_BOT_TOKEN=");
    expect(environment).not.toMatch(/TELEGRAM_BOT_TOKEN=\S+/);
    expect(environment).toContain("FOUNDER_PARTICIPANT_ID=");
    expect(environment).not.toMatch(/FOUNDER_PARTICIPANT_ID=\S+/);
    expect(compose).toContain("FOUNDER_PARTICIPANT_ID: ${FOUNDER_PARTICIPANT_ID:-}");
    expect(compose).toContain("TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}");
    expect(caddy).toContain("reverse_proxy web:3000");
  });

  it("provides idempotent host preparation and update entry points", async () => {
    const bootstrap = await projectFile("deploy/bootstrap.sh");
    const update = await projectFile("deploy/update.sh");

    expect(bootstrap).toContain("command -v docker");
    expect(bootstrap).toContain("swapon --show=NAME");
    expect(bootstrap).toContain("ufw allow 443/tcp");
    expect(update).toContain("git pull --ff-only");
    expect(update).toContain("config --quiet");
    expect(update).toContain('up -d --remove-orphans');
  });
});
