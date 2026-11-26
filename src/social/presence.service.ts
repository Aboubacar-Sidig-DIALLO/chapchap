import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import { InjectPrisma } from '../database/database.module';
import type { PrismaClient } from '../generated/prisma/client';
import type { PresenceChange } from './social.types';

/**
 * Délai avant de passer « hors ligne » : en passant de l'accueil à une
 * conversation, la connexion change, et l'on ne veut pas clignoter.
 */
const OFFLINE_GRACE_MS = 5000;

/**
 * Qui a l'application ouverte, tous appareils et onglets confondus (accueil
 * ou conversation). L'état « en ligne » vit en mémoire ; seule la date de
 * dernière présence est enregistrée, pour afficher « hors ligne depuis… ».
 */
@Injectable()
export class PresenceService implements OnModuleDestroy {
  private readonly logger = new Logger('Presence');
  /** Nombre de connexions ouvertes, par utilisateur. */
  private readonly connections = new Map<string, number>();
  /** Passages « hors ligne » en attente (délai de grâce). */
  private readonly pendingOffline = new Map<string, NodeJS.Timeout>();
  private readonly changesSubject = new Subject<PresenceChange>();

  /** Arrivées et départs effectifs (après le délai de grâce). */
  readonly changes$ = this.changesSubject.asObservable();

  constructor(@InjectPrisma() private readonly prisma: PrismaClient) {}

  onModuleDestroy() {
    this.pendingOffline.forEach((timer) => clearTimeout(timer));
  }

  isOnline(userId: string): boolean {
    return (this.connections.get(userId) ?? 0) > 0;
  }

  /** Une connexion de l'utilisateur vient de s'ouvrir. */
  connected(userId: string) {
    const count = (this.connections.get(userId) ?? 0) + 1;
    this.connections.set(userId, count);

    const pending = this.pendingOffline.get(userId);
    if (pending) {
      // Revenu pendant le délai de grâce : il n'a jamais été hors ligne.
      clearTimeout(pending);
      this.pendingOffline.delete(userId);
    } else if (count === 1) {
      this.changesSubject.next({ userId, online: true, lastSeenAt: null });
    }
  }

  /** Une connexion de l'utilisateur vient de se fermer. */
  disconnected(userId: string) {
    const count = Math.max(0, (this.connections.get(userId) ?? 0) - 1);
    if (count > 0) {
      this.connections.set(userId, count);
      return;
    }

    this.connections.delete(userId);
    if (this.pendingOffline.has(userId)) return;
    const timer = setTimeout(
      () => void this.goOffline(userId),
      OFFLINE_GRACE_MS,
    );
    timer.unref();
    this.pendingOffline.set(userId, timer);
  }

  private async goOffline(userId: string) {
    this.pendingOffline.delete(userId);
    if (this.isOnline(userId)) return;

    const lastSeenAt = new Date();
    try {
      // `updateMany` : un compte supprimé entre-temps n'est pas une erreur.
      await this.prisma.user.updateMany({
        where: { id: userId },
        data: { lastSeenAt },
      });
    } catch (error) {
      // Base momentanément indisponible.
      this.logger.warn(`Dernière présence non enregistrée : ${String(error)}`);
    }
    this.changesSubject.next({
      userId,
      online: false,
      lastSeenAt: lastSeenAt.toISOString(),
    });
  }
}
