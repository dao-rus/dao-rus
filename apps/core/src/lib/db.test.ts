import { afterEach, describe, expect, it, vi } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  vi.resetModules();
});

describe("database runtime configuration", () => {
  it("allows application modules to be imported without DATABASE_URL", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();

    await expect(import("./db")).resolves.toMatchObject({
      getPool: expect.any(Function),
      pool: expect.any(Object),
    });
  });

  it("still requires DATABASE_URL on first runtime database use", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { pool } = await import("./db");

    expect(() => pool.connect()).toThrow("DATABASE_URL is required");
  });
});
