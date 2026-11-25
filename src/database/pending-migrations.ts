import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '../generated/prisma/client';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

/** Migrations présentes dans le projet (un dossier par migration). */
async function listLocalMigrations(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** Migrations appliquées avec succès à la base (aucune si Prisma n'y est jamais passé). */
async function listAppliedMigrations(
  prisma: PrismaClient,
): Promise<Set<string>> {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    return new Set(rows.map((row) => row.migration_name));
  } catch {
    return new Set();
  }
}

/** Migrations du projet pas encore appliquées à la base. */
export async function findPendingMigrations(
  prisma: PrismaClient,
): Promise<string[]> {
  const [local, applied] = await Promise.all([
    listLocalMigrations(),
    listAppliedMigrations(prisma),
  ]);
  return local.filter((name) => !applied.has(name)).sort();
}
