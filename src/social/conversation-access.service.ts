import { Injectable } from '@nestjs/common';
import { InjectPrisma } from '../database/database.module';
import {
  FriendshipStatus,
  type PrismaClient,
} from '../generated/prisma/client';
import { GroupPhotosService } from './group-photos.service';
import {
  DIRECT_RIGHTS,
  groupPermissions,
  memberPermissions,
  rightsOf,
  roleOf,
} from './group-rights';
import type { ConversationRights } from './social.types';
import { pairOf } from './social.utils';

/** Conversation demandée par le client (il ne fabrique jamais lui-même la clé). */
export type ConversationRef =
  { type: 'direct'; userId: string } | { type: 'group'; groupId: string };

/** Conversation dont l'accès a été vérifié. */
export interface Conversation {
  /** Identifiant unique côté serveur (nom de la salle Socket.io). */
  key: string;
  type: ConversationRef['type'];
  /** Nom affiché : l'ami ou le groupe. */
  title: string;
  /** Photo du groupe (adresse relative à l'API) ; `null` pour un ami ou un groupe sans photo. */
  photoUrl: string | null;
  /** Membres : l'ami et soi, ou les membres du groupe. */
  memberIds: string[];
  /**
   * Ce que chaque membre peut y faire, à l'ouverture puis à chaque changement
   * du groupe : de quoi adapter l'interface. Avant chaque action, les droits
   * sont relus en base (`ConversationAccessService.rights`).
   */
  rightsByUser: Record<string, ConversationRights>;
  /** Ami concerné (conversation `direct`). */
  friendId?: string;
  /** Groupe concerné (conversation `group`). */
  groupId?: string;
}

/** Même clé pour les deux amis, quel que soit celui qui ouvre la conversation. */
export function directKey(userId: string, otherId: string) {
  const { userAId, userBId } = pairOf(userId, otherId);
  return `direct:${userAId}:${userBId}`;
}

/** Les deux amis d'une conversation privée ; `null` pour toute autre clé. */
export function directKeyMembers(key: string): [string, string] | null {
  const [type, userAId, userBId, ...rest] = key.split(':');
  if (type !== 'direct' || !userAId || !userBId || rest.length > 0) return null;
  return [userAId, userBId];
}

export function groupKey(groupId: string) {
  return `group:${groupId}`;
}

/** Droits d'un utilisateur dans une conversation ouverte ; `null` s'il n'en est pas membre. */
export function rightsIn(
  conversation: Conversation,
  userId: string,
): ConversationRights | null {
  return conversation.rightsByUser[userId] ?? null;
}

const MAX_ID_LENGTH = 64;

function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

/** Lecture prudente de ce qu'envoie le client. */
export function parseConversationRef(value: unknown): ConversationRef | null {
  const ref = (value ?? {}) as Record<string, unknown>;
  if (ref.type === 'direct' && isId(ref.userId)) {
    return { type: 'direct', userId: ref.userId };
  }
  if (ref.type === 'group' && isId(ref.groupId)) {
    return { type: 'group', groupId: ref.groupId };
  }
  return null;
}

const GROUP_PERMISSIONS_SELECT = {
  ownerId: true,
  membersCanWrite: true,
  membersCanSendVoice: true,
  membersCanCall: true,
} as const;

const MEMBER_RIGHTS_SELECT = {
  userId: true,
  role: true,
  canWrite: true,
  canSendVoice: true,
  canCall: true,
} as const;

type GroupRow = Parameters<typeof groupPermissions>[0] & {
  ownerId: string | null;
};
type MemberRow = Parameters<typeof memberPermissions>[0] &
  Parameters<typeof roleOf>[1];

/** Droits d'un membre, d'après les réglages de son groupe et les siens. */
function memberRights(group: GroupRow, member: MemberRow) {
  return rightsOf(
    roleOf(group.ownerId, member),
    groupPermissions(group),
    memberPermissions(member),
  );
}

/**
 * Qui peut parler où, et comment : une conversation privée exige d'être
 * amis ; une conversation de groupe, d'en être membre, avec les droits que
 * lui laissent son rôle et les restrictions du propriétaire.
 */
@Injectable()
export class ConversationAccessService {
  constructor(@InjectPrisma() private readonly prisma: PrismaClient) {}

  /** La conversation demandée, si `userId` y a accès ; sinon `null`. */
  async open(
    userId: string,
    ref: ConversationRef,
  ): Promise<Conversation | null> {
    switch (ref.type) {
      case 'direct': {
        if (!(await this.areFriends(userId, ref.userId))) return null;
        const friend = await this.prisma.user.findUnique({
          where: { id: ref.userId },
          select: { name: true },
        });
        if (!friend) return null;
        return {
          key: directKey(userId, ref.userId),
          type: 'direct',
          title: friend.name,
          photoUrl: null,
          memberIds: [userId, ref.userId],
          rightsByUser: {
            [userId]: DIRECT_RIGHTS,
            [ref.userId]: DIRECT_RIGHTS,
          },
          friendId: ref.userId,
        };
      }

      case 'group': {
        const conversation = await this.group(ref.groupId);
        return conversation?.memberIds.includes(userId) ? conversation : null;
      }
    }
  }

  /**
   * La conversation d'un groupe, telle qu'elle est maintenant (nom, photo,
   * membres et leurs droits), sans vérifier d'accès ; `null` si le groupe
   * n'existe plus.
   */
  async group(groupId: string): Promise<Conversation | null> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        name: true,
        photo: true,
        ...GROUP_PERMISSIONS_SELECT,
        members: { select: MEMBER_RIGHTS_SELECT },
      },
    });
    if (!group) return null;

    const rightsByUser: Record<string, ConversationRights> = {};
    for (const member of group.members) {
      rightsByUser[member.userId] = memberRights(group, member);
    }
    return {
      key: groupKey(groupId),
      type: 'group',
      title: group.name,
      photoUrl: GroupPhotosService.url(group.photo),
      memberIds: group.members.map((member) => member.userId),
      rightsByUser,
      groupId,
    };
  }

  /**
   * Droits actuels de `userId` dans la conversation, relus en base avant
   * chaque action : une amitié, une appartenance ou une autorisation a pu
   * changer depuis l'ouverture. `null` : il n'y a plus accès.
   */
  async rights(
    userId: string,
    conversation: Conversation,
  ): Promise<ConversationRights | null> {
    if (conversation.friendId) {
      const isFriend = await this.areFriends(userId, conversation.friendId);
      return isFriend ? DIRECT_RIGHTS : null;
    }
    if (!conversation.groupId) return null;

    const member = await this.prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: conversation.groupId, userId } },
      select: {
        ...MEMBER_RIGHTS_SELECT,
        group: { select: GROUP_PERMISSIONS_SELECT },
      },
    });
    return member ? memberRights(member.group, member) : null;
  }

  private async areFriends(userId: string, otherId: string) {
    if (userId === otherId) return false;
    const friendship = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: pairOf(userId, otherId) },
      select: { status: true },
    });
    return friendship?.status === FriendshipStatus.ACCEPTED;
  }
}
