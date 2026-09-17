import { PrismaClient } from "@prisma/client";

// The standard Next.js/Prisma singleton pattern - without it, every hot
// reload in dev creates a new PrismaClient (and a new DB connection pool),
// eventually exhausting SQLite's connection handling. Stash the instance on
// `globalThis` (survives module reloads) outside production, where each
// request gets a fresh process anyway.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
