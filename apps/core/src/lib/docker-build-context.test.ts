import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function dockerignoreRules(): Promise<string[]> {
  const dockerignore = await readFile(
    new URL("../../.dockerignore", import.meta.url),
    "utf8",
  );

  return dockerignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

describe("Docker build context", () => {
  it("excludes local secrets, sessions, backups and generated files", async () => {
    const rules = await dockerignoreRules();

    for (const rule of [
      ".env",
      ".env.*",
      ".local/",
      "*.session",
      "*.session-*",
      "**/*.session",
      "**/*.session-*",
      "*.bak",
      "*.backup",
      "**/*.bak",
      "**/*.backup",
      ".venv/",
      "venv/",
      "node_modules/",
      ".next/",
      "coverage/",
      "tsconfig.tsbuildinfo",
      "__pycache__/",
      "**/__pycache__/",
      "*.pyc",
      "**/*.pyc",
    ]) {
      expect(rules).toContain(rule);
    }
  });

  it("keeps the public env template and required source trees available", async () => {
    const rules = await dockerignoreRules();
    const envWildcard = rules.indexOf(".env.*");
    const envExample = rules.indexOf("!.env.example");

    expect(envWildcard).toBeGreaterThanOrEqual(0);
    expect(envExample).toBeGreaterThan(envWildcard);

    for (const unsafeRule of ["*", "src/", "migrations/", "*.json", "*.ts", "*.tsx"]) {
      expect(rules).not.toContain(unsafeRule);
    }
  });
});
