import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPrisma } from '../database/database.module';
import type { PrismaClient } from '../generated/prisma/client';
import { groupKey } from './conversation-access.service';
import { FriendsService } from './friends.service';
import { OngoingCallsService } from './ongoing-calls.service';
import { PUBLIC_USER_SELECT } from './social.constants';
import type { GroupSummary, OngoingCall } from './social.types';

const GROUP_INCLUDE = {
  members: {
    select: { user: { select: PUBLIC_USER_SELECT } },
    orderBy: { joinedAt: 'asc' },
  },
} as const;

type GroupWithMembers = {
  id: string;
  name: string;
  createdAt: Date;
  members: { user: GroupSummary['members'][number] }[];
};

function toSummary(
  group: GroupWithMembers,
  call: OngoingCall | null,
): GroupSummary {
  return {
    id: group.id,
    name: group.name,
    createdAt: group.createdAt.toISOString(),
    members: group.members.map((member) => member.user),
    call,
  };
}

@Injectable()
export class GroupsService {
  constructor(
    @InjectPrisma() private readonly prisma: PrismaClient,
    private readonly friendsService: FriendsService,
    private readonly ongoingCalls: OngoingCallsService,
  ) {}

  /** Groupes dont l'utilisateur fait partie, du plus récent au plus ancien. */
  async list(userId: string): Promise<GroupSummary[]> {
    const groups = await this.prisma.group.findMany({
      where: { members: { some: { userId } } },
      include: GROUP_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return groups.map((group) =>
      toSummary(group, this.ongoingCalls.get(groupKey(group.id))),
    );
  }

  /** Les autres membres des groupes de `userId`, chacun une fois. */
  async coMemberIds(userId: string): Promise<string[]> {
    const members = await this.prisma.groupMember.findMany({
      where: {
        group: { members: { some: { userId } } },
        userId: { not: userId },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    return members.map((member) => member.userId);
  }

  /**
   * Membres actuels de ces groupes, chacun une fois ; supprime au passage ceux
   * qui n'ont plus personne (le dernier membre vient de partir).
   */
  async pruneAndListMembers(groupIds: string[]): Promise<string[]> {
    if (groupIds.length === 0) return [];
    await this.prisma.group.deleteMany({
      where: { id: { in: groupIds }, members: { none: {} } },
    });
    const members = await this.prisma.groupMember.findMany({
      where: { groupId: { in: groupIds } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return members.map((member) => member.userId);
  }

  /** Membres actuels d'un groupe (vide s'il n'existe plus). */
  async memberIds(groupId: string): Promise<string[]> {
    const members = await this.prisma.groupMember.findMany({
      where: { groupId },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  /** Crée un groupe avec des amis du créateur, qui en fait partie d'office. */
  async create(
    userId: string,
    { name, memberIds }: { name: string; memberIds: string[] },
  ): Promise<GroupSummary> {
    const friendIds = [...new Set(memberIds)].filter((id) => id !== userId);
    if (friendIds.length === 0) {
      throw new BadRequestException('Choisissez au moins un ami');
    }
    if (!(await this.friendsService.areAllFriends(userId, friendIds))) {
      throw new BadRequestException('Un groupe ne peut réunir que vos amis');
    }

    const group = await this.prisma.group.create({
      data: {
        name,
        createdById: userId,
        members: {
          create: [userId, ...friendIds].map((id) => ({ userId: id })),
        },
      },
      include: GROUP_INCLUDE,
    });
    return toSummary(group, null);
  }

  /**
   * Quitte un groupe ; le dernier à partir le supprime.
   * Renvoie les membres restants, à prévenir du changement.
   */
  async leave(userId: string, groupId: string): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.groupMember.deleteMany({
        where: { groupId, userId },
      });
      if (count === 0) throw new NotFoundException('Groupe introuvable');

      const remaining = await tx.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });
      if (remaining.length === 0) {
        await tx.group.delete({ where: { id: groupId } });
      }
      return remaining.map((member) => member.userId);
    });
  }
}
