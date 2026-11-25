import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Client Prisma unique de l'application (une seule réserve de connexions).
 * Instancié hors de l'injection de dépendances : Better Auth en a besoin dès
 * le chargement de sa configuration.
 */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
