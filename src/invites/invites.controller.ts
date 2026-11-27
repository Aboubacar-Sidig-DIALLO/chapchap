import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SocialEvents } from '../social/social-events.service';
import { SocialGateway } from '../social/social.gateway';
import { toPublicUser } from '../social/social.utils';
import {
  type CreateInviteInput,
  createInviteSchema,
  inviteTokenSchema,
} from './invites.schemas';
import { InvitesService } from './invites.service';
import type {
  CreatedInvite,
  InviteAcceptance,
  InvitePreview,
} from './invites.types';

const tokenPipe = new ZodValidationPipe(inviteTokenSchema);

/**
 * Invitations par lien ou QR code. Routes réservées aux utilisateurs
 * connectés (garde globale de Better Auth) : qui ouvre un lien sans compte
 * se connecte ou s'inscrit d'abord, puis revient à l'invitation.
 */
@Controller('invites')
export class InvitesController {
  constructor(
    private readonly invitesService: InvitesService,
    private readonly socialGateway: SocialGateway,
    private readonly socialEvents: SocialEvents,
  ) {}

  /**
   * `POST /invites` : invitation à devenir ami, ou à rejoindre un groupe
   * (propriétaire ou administrateur). Valable une minute.
   */
  @Post()
  create(
    @Session() session: UserSession,
    @Body(new ZodValidationPipe(createInviteSchema)) body: CreateInviteInput,
  ): Promise<CreatedInvite> {
    return this.invitesService.create(session.user.id, body.target, body.renew);
  }

  /** `GET /invites/:token` : ce à quoi invite le lien, vu par celui qui l'ouvre. */
  @Get(':token')
  preview(
    @Session() session: UserSession,
    @Param('token', tokenPipe) token: string,
  ): Promise<InvitePreview> {
    return this.invitesService.preview(session.user.id, token);
  }

  /**
   * `POST /invites/:token/accept` : devient ami de l'auteur, ou rejoint le
   * groupe. L'auteur en est prévenu ; les listes des intéressés se mettent à jour.
   */
  @Post(':token/accept')
  @HttpCode(200)
  async accept(
    @Session() session: UserSession,
    @Param('token', tokenPipe) token: string,
  ): Promise<InviteAcceptance> {
    const me = session.user.id;
    const { conversation, inviterId, changed, group } =
      await this.invitesService.accept(me, token);
    if (!changed) return conversation;

    this.socialGateway.notifyChange([inviterId], {
      type: 'invite-accepted',
      user: toPublicUser(session.user),
      group: group && { id: group.id, name: group.name },
    });
    // Mes autres onglets, et les autres membres du groupe, sans annonce.
    const others = (group?.memberIds ?? []).filter((id) => id !== inviterId);
    this.socialGateway.notifyChange([...new Set([me, ...others])]);
    if (group) this.socialEvents.groupUpdated(group.id);
    return conversation;
  }

  /** `DELETE /invites/:token` : son auteur désactive le lien avant l'heure. */
  @Delete(':token')
  @HttpCode(204)
  revoke(
    @Session() session: UserSession,
    @Param('token', tokenPipe) token: string,
  ): void {
    this.invitesService.revoke(session.user.id, token);
  }
}
