import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';
import webpush, { WebPushError } from 'web-push';
import { accountEvents } from '../auth/account-events';
import { InjectPrisma } from '../database/database.module';
import type { PrismaClient } from '../generated/prisma/client';
import { QuietModeService } from '../quiet-mode/quiet-mode.service';
import { VAPID } from './push.config';
import type { SubscriptionInput } from './push.schemas';
import type { PushDelivery, PushNotification } from './push.types';

/** Réponses du service push : cet abonnement n'existe plus (désinstallé, révoqué…). */
const GONE_STATUSES = new Set([404, 410]);

/**
 * Notifications push : abonnements des navigateurs, et envoi.
 *
 * L'envoi ne bloque jamais l'appelant (message, appel…) : il part en tâche
 * de fond, et un échec est seulement journalisé. Les abonnements morts sont
 * effacés à la première tentative.
 */
@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Push');
  private subscription?: Subscription;
  readonly isEnabled = Boolean(VAPID.publicKey && VAPID.privateKey);

  constructor(
    @InjectPrisma() private readonly prisma: PrismaClient,
    private readonly quietMode: QuietModeService,
  ) {}

  onModuleInit() {
    if (this.isEnabled) {
      webpush.setVapidDetails(VAPID.subject, VAPID.publicKey, VAPID.privateKey);
    } else {
      this.logger.warn(
        'Notifications push désactivées : définissez VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY (`npx web-push generate-vapid-keys`).',
      );
    }

    // Sessions fermées partout (adresse changée, compte suspendu…) : plus aucune notification sur ces appareils.
    this.subscription = accountEvents.signedOutEverywhere$.subscribe(
      ({ userId }) => void this.removeAll(userId),
    );
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  /** Clé publique à donner aux navigateurs ; `null` si les notifications sont désactivées. */
  get publicKey(): string | null {
    return this.isEnabled ? VAPID.publicKey : null;
  }

  /**
   * Abonne ce navigateur. Déjà abonné pour un autre compte (changement
   * d'utilisateur sur le même appareil), il passe au nouveau.
   */
  async subscribe(userId: string, { endpoint, keys }: SubscriptionInput) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { userId, p256dh: keys.p256dh, auth: keys.auth },
    });
  }

  /** Désabonne ce navigateur (seulement s'il appartient bien à cet utilisateur). */
  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
  }

  async removeAll(userId: string) {
    try {
      await this.prisma.pushSubscription.deleteMany({ where: { userId } });
    } catch (error) {
      this.logger.warn(`Abonnements non effacés : ${String(error)}`);
    }
  }

  /** Envoie la notification à tous les appareils de ces utilisateurs, en tâche de fond. */
  send(
    userIds: string[],
    notification: PushNotification,
    delivery: PushDelivery,
  ) {
    if (!this.isEnabled || userIds.length === 0) return;
    this.deliver([...new Set(userIds)], notification, delivery).catch((error) =>
      this.logger.warn(`Envoi impossible : ${String(error)}`),
    );
  }

  private async deliver(
    userIds: string[],
    notification: PushNotification,
    delivery: PushDelivery,
  ) {
    const [subscriptions, quietIds] = await Promise.all([
      this.prisma.pushSubscription.findMany({
        where: { userId: { in: userIds } },
      }),
      this.quietMode.quietUserIds(userIds),
    ]);
    // Heures calmes : la notification arrive quand même, mais sans bruit.
    const quiet = new Set(quietIds);
    const payloads = {
      normal: JSON.stringify(notification),
      silent: JSON.stringify({ ...notification, silent: true }),
    };
    await Promise.all(
      subscriptions.map((subscription) =>
        this.sendTo(
          subscription,
          quiet.has(subscription.userId) ? payloads.silent : payloads.normal,
          delivery,
        ),
      ),
    );
  }

  private async sendTo(
    subscription: {
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    },
    payload: string,
    { ttl, urgency }: PushDelivery,
  ) {
    const { endpoint, p256dh, auth } = subscription;
    try {
      await webpush.sendNotification(
        { endpoint, keys: { p256dh, auth } },
        payload,
        {
          TTL: ttl,
          urgency,
        },
      );
    } catch (error) {
      if (
        error instanceof WebPushError &&
        GONE_STATUSES.has(error.statusCode)
      ) {
        await this.prisma.pushSubscription
          .delete({ where: { id: subscription.id } })
          .catch(() => {});
        return;
      }
      this.logger.warn(
        `Notification non livrée (${new URL(endpoint).hostname}) : ${error instanceof WebPushError ? error.statusCode : String(error)}`,
      );
    }
  }
}
