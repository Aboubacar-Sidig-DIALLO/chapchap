import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  AllowAnonymous,
  Session,
  type UserSession,
} from '@thallesp/nestjs-better-auth';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  type ClaimGuestLinkInput,
  claimGuestLinkSchema,
  type CreateGuestLinkInput,
  createGuestLinkSchema,
  guestTokenSchema,
} from './call-guests.schemas';
import { CallGuestsService } from './call-guests.service';
import type {
  CreatedGuestLink,
  GuestClaim,
  GuestLinkPreview,
} from './call-guests.types';

const tokenPipe = new ZodValidationPipe(guestTokenSchema);

/**
 * Liens d'invité d'un appel de groupe. Les créer ou les retirer demande une
 * session (propriétaire ou administrateur, dans l'appel) ; les consulter et
 * les utiliser, non : l'invité n'a pas de compte. Ces deux routes publiques
 * ne donnent accès qu'à l'appel, jamais au groupe ni à ses messages.
 */
@Controller('call-guests')
export class CallGuestsController {
  constructor(private readonly callGuests: CallGuestsService) {}

  /** `POST /call-guests` : nouveau lien à usage unique pour l'appel en cours du groupe. */
  @Post()
  create(
    @Session() session: UserSession,
    @Body(new ZodValidationPipe(createGuestLinkSchema))
    body: CreateGuestLinkInput,
  ): Promise<CreatedGuestLink> {
    const { id, name } = session.user;
    return this.callGuests.createLink({ id, name }, body.groupId);
  }

  /** `GET /call-guests/:token` : l'appel auquel le lien invite (public). */
  @Get(':token')
  @AllowAnonymous()
  preview(@Param('token', tokenPipe) token: string): Promise<GuestLinkPreview> {
    return this.callGuests.preview(token);
  }

  /** `POST /call-guests/:token/claim` : utilise le lien, une seule fois (public). */
  @Post(':token/claim')
  @AllowAnonymous()
  @HttpCode(200)
  claim(
    @Param('token', tokenPipe) token: string,
    @Body(new ZodValidationPipe(claimGuestLinkSchema))
    body: ClaimGuestLinkInput,
  ): Promise<GuestClaim> {
    return this.callGuests.claim(token, body.name);
  }

  /** `DELETE /call-guests/:token` : son auteur retire un lien encore inutilisé. */
  @Delete(':token')
  @HttpCode(204)
  revoke(
    @Session() session: UserSession,
    @Param('token', tokenPipe) token: string,
  ): void {
    this.callGuests.revokeLink(session.user.id, token);
  }
}
