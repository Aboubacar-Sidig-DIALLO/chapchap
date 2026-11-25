import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { findPendingMigrations } from './pending-migrations';
import { prisma } from './prisma';

const PRISMA = Symbol('PRISMA');

/** Injecte le client Prisma de l'application : `constructor(@InjectPrisma() prisma: PrismaClient)`. */
export const InjectPrisma = () => Inject(PRISMA);

/** Rend le client Prisma (instance unique, partagée avec Better Auth) injectable partout. */
@Global()
@Module({
  providers: [{ provide: PRISMA, useValue: prisma }],
  exports: [PRISMA],
})
export class DatabaseModule implements OnApplicationBootstrap {
  private readonly logger = new Logger('Database');

  /**
   * Signale au démarrage une base en retard sur le schéma : sans cela, l'oubli
   * ne se remarque qu'à la première requête qui touche une table manquante.
   */
  async onApplicationBootstrap() {
    try {
      const pending = await findPendingMigrations(prisma);
      if (pending.length > 0) {
        this.logger.warn(
          `Base de données en retard : ${pending.length} migration(s) à appliquer (${pending.join(', ')}). Lancez \`pnpm db:deploy\`.`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Vérification des migrations impossible : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
