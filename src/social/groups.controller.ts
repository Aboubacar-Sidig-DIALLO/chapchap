import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { memoryStorage } from 'multer';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { groupKey } from './conversation-access.service';
import { GroupsService } from './groups.service';
import { SocialEvents } from './social-events.service';
import { SocialGateway } from './social.gateway';
import { GROUP_PHOTO_MAX_SIZE } from './social.constants';
import {
  type AddGroupMembersInput,
  addGroupMembersSchema,
  type CreateGroupInput,
  createGroupSchema,
  type GroupPermissionsInput,
  groupPermissionsSchema,
  idSchema,
  type LeaveGroupInput,
  leaveGroupSchema,
  type RenameGroupInput,
  renameGroupSchema,
  type UpdateGroupMemberInput,
  updateGroupMemberSchema,
} from './social.schemas';
import type { GroupSummary } from './social.types';
import { toPublicUser } from './social.utils';

const groupIdPipe = new ZodValidationPipe(idSchema);

/**
 * Routes réservées aux utilisateurs connectés (garde globale de Better Auth).
 * Les droits (membre, administrateur, propriétaire) sont vérifiés par
 * `GroupsService`.
 * Après chaque changement, les membres concernés sont prévenus en temps réel.
 */
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

  /** `GET /groups/:groupId` : un de mes groupes. */
  @Get(':groupId')
  get(
    @Session() session: UserSession,
    @Param('groupId', groupIdPipe) groupId: string,
  ): Promise<GroupSummary> {
    return this.groupsService.get(session.user.id, groupId);
  }

  /** `POST /groups` : crée un groupe avec des amis, prévenus en temps réel. */
  @Post()
  async create(
    @Session() session: UserSession,
    @Body(new ZodValidationPipe(createGroupSchema)) body: CreateGroupInput,
  ): Promise<GroupSummary> {
    const me = session.user.id;
    const group = await this.groupsService.create(me, body);
    this.announceNewMembers(
      session,
      group,
      group.members.map((member) => member.id).filter((id) => id !== me),
    );
    // Mes autres onglets et appareils se mettent à jour, sans annonce.
    this.socialGateway.notifyChange([me]);
    return group;
  }

  /** `PATCH /groups/:groupId` : renomme le groupe (propriétaire). */
  @Patch(':groupId')
  async rename(
    @Session() session: UserSession,
    @Param('groupId', groupIdPipe) groupId: string,
    @Body(new ZodValidationPipe(renameGroupSchema)) body: RenameGroupInput,
  ): Promise<GroupSummary> {
    const group = await this.groupsService.rename(
      session.user.id,
      groupId,
      body.name,
    );
    this.notifyMembers(group);
    return group;
  }

  /**
   * `PUT /groups/:groupId/permissions` : ce que les simples membres peuvent
   * faire (propriétaire). Les conversations ouvertes s'y adaptent aussitôt.
   */
  @Put(':groupId/permissions')
  async setPermissions(
    @Session() session: UserSession,
    @Param('groupId', groupIdPipe) groupId: string,
    @Body(new ZodValidationPipe(groupPermissionsSchema))
    body: GroupPermissionsInput,
  ): Promise<GroupSummary> {
    const group = await this.groupsService.setPermissions(
      session.user.id,
      groupId,
      body,
    );
    this.notifyMembers(group);
    return group;
  }

  /**
   * `PUT /groups/:groupId/photo` : nouvelle photo (propriétaire), champ
   * `photo` d'un formulaire multipart. Gardée en mémoire le temps d'en
   * vérifier le format, puis enregistrée.
   */
  @Put(':groupId/photo')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: GROUP_PHOTO_MAX_SIZE, files: 1 },
    }),
  )
  async setPhoto(
    @Session() session: UserSession,
    @Param('groupId', groupIdPipe) groupId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<GroupSummary> {
    if (!file) throw new BadRequestException('Aucune photo reçue');
    const group = await this.groupsService.setPhoto(
      session.user.id,
      groupId,
      file.buffer,
    );
    this.notifyMembers(group);
    return group;
  }

  /** `DELETE /groups/:groupId/photo` : retire la photo (propriétaire). */
  @Delete(':groupId/photo')
  async removePhoto(
    @Session() session: UserSession,
    @Param('groupId', groupIdPipe) groupId: string,
  ): Promise<GroupSummary> {
    const group = await this.groupsService.setPhoto(
      session.user.id,
      groupId,
      null,
    );
    this.notifyMembers(group);
    return group;
  }

  /** `POST /groups/:groupId/members` : ajoute des amis au groupe (propriétaire ou administrateur). */
  @Post(':groupId/members')
  async addMembers(
    @Session() session: UserSession,
    @Param('groupId', groupIdPipe) groupId: string,
    @Body(new ZodValidationPipe(addGroupMembersSchema))
    body: AddGroupMembersInput,
  ): Promise<GroupSummary> {
    const { group, addedIds } = await this.groupsService.addMembers(
      session.user.id,
      groupId,
      body.memberIds,
    );
    this.announceNewMembers(session, group, addedIds);
    this.notifyMembers(group, addedIds);
    return group;
  }

  /**
   * `PATCH /groups/:groupId/members/:userId` : nomme ou destitue un
   * administrateur, ou règle les restrictions d'un membre (propriétaire).
   */
  @Patch(':groupId/members/:userId')
  async updateMember(
    @Session() session: UserSession,
    @Param('groupId', groupIdPipe) groupId: string,
    @Param('userId', new ZodValidationPipe(idSchema)) userId: string,
    @Body(new ZodValidationPipe(updateGroupMemberSchema))
    body: UpdateGroupMemberInput,
  ): Promise<GroupSummary> {
    const group = await this.groupsService.updateMember(
      session.user.id,
      groupId,
      userId,
      body,
    );
    this.notifyMembers(group);
    return group;
  }

  /** `DELETE /groups/:groupId/members/:userId` : retire un membre (propriétaire). */
  @Delete(':groupId/members/:userId')
  @HttpCode(204)
  async removeMember(
    @Session() session: UserSession,
    @Param('groupId', groupIdPipe) groupId: string,
    @Param('userId', new ZodValidationPipe(idSchema)) userId: string,
  ): Promise<void> {
    const remainingIds = await this.groupsService.removeMember(
      session.user.id,
      groupId,
      userId,
    );
    this.socialGateway.notifyChange([userId, ...remainingIds]);
    this.socialEvents.revokeAccess({
      conversationKey: groupKey(groupId),
      userIds: [userId],
    });
    this.socialEvents.groupUpdated(groupId);
  }

  /**
   * `POST /groups/:groupId/leave` : quitte le groupe. Le propriétaire
   * désigne son successeur (`successorId`) tant qu'il reste des membres.
   */
  @Post(':groupId/leave')
  @HttpCode(204)
  async leave(
    @Session() session: UserSession,
    @Param('groupId', groupIdPipe) groupId: string,
    @Body(new ZodValidationPipe(leaveGroupSchema)) body: LeaveGroupInput,
  ): Promise<void> {
    const me = session.user.id;
    const remainingIds = await this.groupsService.leave(
      me,
      groupId,
      body.successorId,
    );
    // Mise à jour silencieuse pour les membres restants et mes autres onglets.
    this.socialGateway.notifyChange([me, ...remainingIds]);
    // Plus membre : la conversation du groupe se ferme pour lui.
    this.socialEvents.revokeAccess({
      conversationKey: groupKey(groupId),
      userIds: [me],
    });
    if (remainingIds.length > 0) this.socialEvents.groupUpdated(groupId);
  }

  /** Annonce le groupe à ceux qui viennent d'y être ajoutés. */
  private announceNewMembers(
    session: UserSession,
    group: GroupSummary,
    userIds: string[],
  ) {
    this.socialGateway.notifyChange(userIds, {
      type: 'group-added',
      user: toPublicUser(session.user),
      groupName: group.name,
    });
  }

  /**
   * Mise à jour silencieuse pour les membres (sauf `exceptIds`, déjà
   * prévenus), et pour les conversations ouvertes du groupe.
   */
  private notifyMembers(group: GroupSummary, exceptIds: string[] = []) {
    this.socialGateway.notifyChange(
      group.members
        .map((member) => member.id)
        .filter((id) => !exceptIds.includes(id)),
    );
    this.socialEvents.groupUpdated(group.id);
  }
}
