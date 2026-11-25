import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { directKey } from './conversation-access.service';
import { FriendsService } from './friends.service';
import { SocialEvents } from './social-events.service';
import { SocialGateway } from './social.gateway';
import { idSchema, searchQuerySchema } from './social.schemas';
import { toPublicUser } from './social.utils';
import type { FriendsOverview, Relation, SearchResult } from './social.types';

/** Routes réservées aux utilisateurs connectés (garde globale de Better Auth). */
@Controller()
export class FriendsController {
  constructor(
    private readonly friendsService: FriendsService,
    private readonly socialGateway: SocialGateway,
    private readonly socialEvents: SocialEvents,
  ) {}

  /** `GET /users/search?q=` : recherche par nom. */
  @Get('users/search')
  search(
    @Session() session: UserSession,
    @Query('q', new ZodValidationPipe(searchQuerySchema)) query: string,
  ): Promise<SearchResult[]> {
    return this.friendsService.search(session.user.id, query);
  }

  /** `GET /friends` : amis et demandes en cours. */
  @Get('friends')
  overview(@Session() session: UserSession): Promise<FriendsOverview> {
    return this.friendsService.overview(session.user.id);
  }

  /**
   * `POST /friends/:userId` : envoie une demande, ou accepte celle reçue.
   * L'autre personne en est prévenue en temps réel.
   */
  @Post('friends/:userId')
  @HttpCode(200)
  async add(
    @Session() session: UserSession,
    @Param('userId', new ZodValidationPipe(idSchema)) userId: string,
  ): Promise<{ relation: Relation }> {
    const me = session.user.id;
    const { relation, changed } = await this.friendsService.addFriend(
      me,
      userId,
    );

    if (changed) {
      const type = relation === 'friend' ? 'friend-accepted' : 'friend-request';
      this.socialGateway.notifyChange([userId], {
        type,
        user: toPublicUser(session.user),
      });
      // Mes autres onglets et appareils se mettent à jour, sans annonce.
      this.socialGateway.notifyChange([me]);
    }
    return { relation };
  }

  /**
   * `DELETE /friends/:userId` : retire un ami, refuse ou annule une demande.
   * Les listes des deux personnes se mettent à jour, sans annonce : on ne
   * signale pas un refus.
   */
  @Delete('friends/:userId')
  async remove(
    @Session() session: UserSession,
    @Param('userId', new ZodValidationPipe(idSchema)) userId: string,
  ): Promise<{ relation: Relation }> {
    const me = session.user.id;
    const { relation, changed } = await this.friendsService.removeFriend(
      me,
      userId,
    );

    if (changed) {
      this.socialGateway.notifyChange([me, userId]);
      // Plus amis : leur conversation privée se ferme aussitôt, des deux côtés.
      this.socialEvents.revokeAccess({
        conversationKey: directKey(me, userId),
        userIds: [me, userId],
      });
    }
    return { relation };
  }
}
