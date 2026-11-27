import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  subscriptionSchema,
  type SubscriptionInput,
  unsubscribeSchema,
} from './push.schemas';
import { PushService } from './push.service';

/** Abonnement aux notifications push (utilisateurs connectés : garde globale de Better Auth). */
@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  /** `GET /push/public-key` : clé à donner au navigateur ; `null` si les notifications sont désactivées. */
  @Get('public-key')
  publicKey(): { publicKey: string | null } {
    return { publicKey: this.pushService.publicKey };
  }

  /** `POST /push/subscriptions` : abonne ce navigateur (idempotent). */
  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(
    @Session() session: UserSession,
    @Body(new ZodValidationPipe(subscriptionSchema)) body: SubscriptionInput,
  ): Promise<void> {
    await this.pushService.subscribe(session.user.id, body);
  }

  /** `DELETE /push/subscriptions` : désabonne ce navigateur (déconnexion, désactivation). */
  @Delete('subscriptions')
  @HttpCode(204)
  async unsubscribe(
    @Session() session: UserSession,
    @Body(new ZodValidationPipe(unsubscribeSchema)) body: { endpoint: string },
  ): Promise<void> {
    await this.pushService.unsubscribe(session.user.id, body.endpoint);
  }
}
