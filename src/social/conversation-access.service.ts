import { Injectable } from '@nestjs/common';
import { InjectPrisma } from '../database/database.module';
import {
  FriendshipStatus,
  type PrismaClient,
} from '../generated/prisma/client';
import { GroupPhotosService } from './group-photos.service';
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

/**
 * Qui peut parler où : une conversation privée exige d'être amis ; une
 * conversation de groupe, d'en être membre.
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
   * membres), sans vérifier d'accès ; `null` si le groupe n'existe plus.
   */
  async group(groupId: string): Promise<Conversation | null> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        name: true,
        photo: true,
        members: { select: { userId: true } },
      },
    });
    if (!group) return null;
    return {
      key: groupKey(groupId),
      type: 'group',
      title: group.name,
      photoUrl: GroupPhotosService.url(group.photo),
      memberIds: group.members.map((member) => member.userId),
      groupId,
    };
  }

  /** Revérifie l'accès (avant chaque envoi) : une amitié ou une appartenance a pu prendre fin. */
  async canAccess(
    userId: string,
    conversation: Conversation,
  ): Promise<boolean> {
    if (conversation.friendId) {
      return this.areFriends(userId, conversation.friendId);
    }
    if (conversation.groupId) {
      const membership = await this.prisma.groupMember.findUnique({
        where: {
          groupId_userId: { groupId: conversation.groupId, userId },
        },
        select: { userId: true },
      });
      return membership !== null;
    }
    return true;
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
