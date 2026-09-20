import { Pool } from "pg";

const globalForPool = globalThis as typeof globalThis & { __daoPool?: Pool };
let productionPool: Pool | undefined;

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new Pool({ connectionString, max: 10 });
}

export function getPool(): Pool {
  const existingPool =
    process.env.NODE_ENV === "production"
      ? productionPool
      : globalForPool.__daoPool;
  if (existingPool) return existingPool;

  const createdPool = makePool();
  if (process.env.NODE_ENV === "production") {
    productionPool = createdPool;
  } else {
    globalForPool.__daoPool = createdPool;
  }
  return createdPool;
}

export const pool = new Proxy({} as Pool, {
  get(_target, property) {
    const runtimePool = getPool();
    const value = Reflect.get(runtimePool, property, runtimePool);
    return typeof value === "function" ? value.bind(runtimePool) : value;
  },
});
