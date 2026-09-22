import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __smmPrisma: PrismaClient | undefined;
}

// Reuse a single PrismaClient across Next.js hot-reloads / serverless
// invocations in the same process instead of opening a new pool each time.
export const prisma =
  globalThis.__smmPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__smmPrisma = prisma;
}

export * from "@prisma/client";
