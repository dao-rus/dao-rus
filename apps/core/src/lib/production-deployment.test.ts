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
    expect(dockerfile).toContain("src/lib/telegram-roster.ts");
    expect(dockerfile).toContain("src/lib/db.ts");
  });

  it("publishes only Caddy while keeping PostgreSQL on the internal network", async () => {
    const compose = await projectFile("compose.prod.yml");
    const db = serviceBlock(compose, "db", "migrate");
    const web = serviceBlock(compose, "web", "caddy");
    const caddy = serviceBlock(compose, "caddy");

    expect(db).not.toContain("ports:");
    expect(web).not.toContain("ports:");
    expect(db).toContain("- backend");
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

    expect(gitignore).toContain(".env.production");
    expect(environment).toContain("APP_BASE_URL=https://core.daorus.org");
    expect(environment).toContain(
      "TELEGRAM_OIDC_REDIRECT_URI=https://core.daorus.org/api/auth/telegram/callback",
    );
    expect(environment).not.toMatch(/TELEGRAM_OIDC_CLIENT_SECRET=\S+/);
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
