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
import { groupKey } from './conversation-access.service';
import { GroupsService } from './groups.service';
import { SocialEvents } from './social-events.service';
import { SocialGateway } from './social.gateway';
import {
  type CreateGroupInput,
  createGroupSchema,
  idSchema,
} from './social.schemas';
import type { GroupSummary } from './social.types';
import { toPublicUser } from './social.utils';

/** Routes réservées aux utilisateurs connectés (garde globale de Better Auth). */
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly socialGateway: SocialGateway,
    private readonly socialEvents: SocialEvents,
  ) {}

  /** `GET /groups` : mes groupes. */
  @Get()
  list(@Session() session: UserSession): Promise<GroupSummary[]> {
    return this.groupsService.list(session.user.id);
  }

  /** `POST /groups` : crée un groupe avec des amis, prévenus en temps réel. */
  @Post()
  async create(
    @Session() session: UserSession,
    @Body(new ZodValidationPipe(createGroupSchema)) body: CreateGroupInput,
  ): Promise<GroupSummary> {
    const me = session.user.id;
    const group = await this.groupsService.create(me, body);

    const addedIds = group.members
      .map((member) => member.id)
      .filter((id) => id !== me);
    this.socialGateway.notifyChange(addedIds, {
      type: 'group-added',
      user: toPublicUser(session.user),
      groupName: group.name,
    });
    // Mes autres onglets et appareils se mettent à jour, sans annonce.
    this.socialGateway.notifyChange([me]);
    return group;
  }

  /** `DELETE /groups/:groupId/membership` : quitte le groupe. */
  @Delete(':groupId/membership')
  @HttpCode(204)
  async leave(
    @Session() session: UserSession,
    @Param('groupId', new ZodValidationPipe(idSchema)) groupId: string,
  ): Promise<void> {
    const me = session.user.id;
    const remainingIds = await this.groupsService.leave(me, groupId);
    // Mise à jour silencieuse pour les membres restants et mes autres onglets.
    this.socialGateway.notifyChange([me, ...remainingIds]);
    // Plus membre : la conversation du groupe se ferme pour lui.
    this.socialEvents.revokeAccess({
      conversationKey: groupKey(groupId),
      userIds: [me],
    });
  }
}
