import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPrisma } from '../database/database.module';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { groupKey } from './conversation-access.service';
import { FriendsService } from './friends.service';
import { GroupPhotosService } from './group-photos.service';
import { OngoingCallsService } from './ongoing-calls.service';
import { GROUP_MAX_MEMBERS, PUBLIC_USER_SELECT } from './social.constants';
import type { GroupSummary, PublicUser } from './social.types';

type Db = PrismaClient | Prisma.TransactionClient;

/** Ordre d'ancienneté des membres : le premier arrivé d'abord. */
const BY_SENIORITY = [
  { joinedAt: 'asc' },
  { userId: 'asc' },
] satisfies Prisma.GroupMemberOrderByWithRelationInput[];

const GROUP_INCLUDE = {
  members: {
    select: { user: { select: PUBLIC_USER_SELECT } },
    orderBy: BY_SENIORITY,
  },
} as const;

interface GroupWithMembers {
  id: string;
  name: string;
  photo: string | null;
  ownerId: string | null;
  createdAt: Date;
  members: { user: PublicUser }[];
}

/** Un groupe modifié, et ceux à prévenir. */
export interface GroupChange {
  group: GroupSummary;
  /** Nouveaux membres (ajout) : on leur annonce le groupe. */
  addedIds: string[];
}

const NOT_FOUND = 'Groupe introuvable';
const OWNER_ONLY = 'Seul le propriétaire du groupe peut le modifier';

/**
 * Groupes d'amis. Chaque groupe a un propriétaire, toujours membre : lui seul
 * le renomme, change sa photo, y ajoute ou en retire des membres. Quand il
 * part, le membre le plus ancien prend le relais ; le dernier à partir
 * supprime le groupe.
 */
@Injectable()
export class GroupsService {
  constructor(
    @InjectPrisma() private readonly prisma: PrismaClient,
    private readonly friendsService: FriendsService,
    private readonly ongoingCalls: OngoingCallsService,
    private readonly groupPhotos: GroupPhotosService,
  ) {}

  /** Groupes dont l'utilisateur fait partie, du plus récent au plus ancien. */
  async list(userId: string): Promise<GroupSummary[]> {
    const groups = await this.prisma.group.findMany({
      where: { members: { some: { userId } } },
      include: GROUP_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return groups.map((group) => this.toSummary(group));
  }

  /** Un groupe dont l'utilisateur fait partie. */
  async get(userId: string, groupId: string): Promise<GroupSummary> {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, members: { some: { userId } } },
      include: GROUP_INCLUDE,
    });
    if (!group) throw new NotFoundException(NOT_FOUND);
    return this.toSummary(group);
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
   * Après la suppression d'un compte : supprime ses groupes restés sans
   * membre, donne un nouveau propriétaire à ceux qu'il administrait, et
   * renvoie les membres restants, chacun une fois.
   */
  async pruneAndListMembers(groupIds: string[]): Promise<string[]> {
    if (groupIds.length === 0) return [];

    const empty = await this.prisma.group.findMany({
      where: { id: { in: groupIds }, members: { none: {} } },
      select: { id: true, photo: true },
    });
    await this.prisma.group.deleteMany({
      where: { id: { in: empty.map((group) => group.id) } },
    });
    await Promise.all(
      empty.map((group) => this.groupPhotos.remove(group.photo)),
    );

    const ownerless = await this.prisma.group.findMany({
      where: { id: { in: groupIds }, ownerId: null },
      select: { id: true },
    });
    for (const group of ownerless) await handOver(this.prisma, group.id);

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

  /** Crée un groupe avec des amis du créateur, qui en devient le propriétaire. */
  async create(
    userId: string,
    { name, memberIds }: { name: string; memberIds: string[] },
  ): Promise<GroupSummary> {
    const friendIds = await this.validFriendIds(userId, memberIds);

    const group = await this.prisma.group.create({
      data: {
        name,
        ownerId: userId,
        members: {
          create: [userId, ...friendIds].map((id) => ({ userId: id })),
        },
      },
      include: GROUP_INCLUDE,
    });
    return this.toSummary(group);
  }

  /** Renomme le groupe (propriétaire uniquement). */
  async rename(
    userId: string,
    groupId: string,
    name: string,
  ): Promise<GroupSummary> {
    await this.requireOwner(this.prisma, userId, groupId);
    const group = await this.prisma.group.update({
      where: { id: groupId },
      data: { name },
      include: GROUP_INCLUDE,
    });
    return this.toSummary(group);
  }

  /**
   * Remplace la photo du groupe (`bytes`), ou la retire (`null`). Propriétaire
   * uniquement ; l'ancienne photo est supprimée du disque.
   */
  async setPhoto(
    userId: string,
    groupId: string,
    bytes: Buffer | null,
  ): Promise<GroupSummary> {
    // Vérifié avant d'écrire quoi que ce soit sur le disque.
    const { photo: previous } = await this.requireOwner(
      this.prisma,
      userId,
      groupId,
    );
    const photo = bytes ? await this.groupPhotos.save(bytes) : null;

    try {
      const group = await this.prisma.group.update({
        where: { id: groupId },
        data: { photo },
        include: GROUP_INCLUDE,
      });
      await this.groupPhotos.remove(previous);
      return this.toSummary(group);
    } catch (error) {
      await this.groupPhotos.remove(photo);
      throw error;
    }
  }

  /** Ajoute des amis du propriétaire au groupe (propriétaire uniquement). */
  async addMembers(
    userId: string,
    groupId: string,
    memberIds: string[],
  ): Promise<GroupChange> {
    const friendIds = await this.validFriendIds(userId, memberIds);

    const addedIds = await this.prisma.$transaction(async (tx) => {
      await this.requireOwner(tx, userId, groupId);
      const current = await tx.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });
      const currentIds = new Set(current.map((member) => member.userId));
      const newIds = friendIds.filter((id) => !currentIds.has(id));
      if (currentIds.size + newIds.length > GROUP_MAX_MEMBERS) {
        throw new BadRequestException(
          `Un groupe compte au plus ${GROUP_MAX_MEMBERS} membres`,
        );
      }
      await tx.groupMember.createMany({
        data: newIds.map((id) => ({ groupId, userId: id })),
        skipDuplicates: true,
      });
      return newIds;
    });

    return { group: await this.get(userId, groupId), addedIds };
  }

  /**
   * Retire un membre du groupe (propriétaire uniquement, qui ne peut pas se
   * retirer lui-même : il quitte le groupe). Renvoie les membres restants.
   */
  async removeMember(
    userId: string,
    groupId: string,
    memberId: string,
  ): Promise<string[]> {
    if (memberId === userId) {
      throw new BadRequestException('Pour partir, quittez le groupe');
    }
    return this.prisma.$transaction(async (tx) => {
      await this.requireOwner(tx, userId, groupId);
      const { count } = await tx.groupMember.deleteMany({
        where: { groupId, userId: memberId },
      });
      if (count === 0) {
        throw new NotFoundException(
          'Cette personne ne fait plus partie du groupe',
        );
      }
      return memberIdsOf(tx, groupId);
    });
  }

  /**
   * Quitte un groupe. Le propriétaire qui part passe la main au membre le
   * plus ancien ; le dernier à partir supprime le groupe (et sa photo).
   * Renvoie les membres restants, à prévenir du changement.
   */
  async leave(userId: string, groupId: string): Promise<string[]> {
    const { remaining, deletedPhoto } = await this.prisma.$transaction(
      async (tx) => {
        const group = await tx.group.findFirst({
          where: { id: groupId, members: { some: { userId } } },
          select: { ownerId: true, photo: true },
        });
        if (!group) throw new NotFoundException(NOT_FOUND);

        await tx.groupMember.delete({
          where: { groupId_userId: { groupId, userId } },
        });
        const remaining = await memberIdsOf(tx, groupId);
        if (remaining.length === 0) {
          await tx.group.delete({ where: { id: groupId } });
          return { remaining, deletedPhoto: group.photo };
        }
        if (group.ownerId === userId) await handOver(tx, groupId);
        return { remaining, deletedPhoto: null };
      },
    );

    await this.groupPhotos.remove(deletedPhoto);
    return remaining;
  }

  /** Le groupe, si `userId` en est le propriétaire ; sinon une erreur explicite. */
  private async requireOwner(db: Db, userId: string, groupId: string) {
    const group = await db.group.findFirst({
      where: { id: groupId, members: { some: { userId } } },
      select: { ownerId: true, photo: true },
    });
    if (!group) throw new NotFoundException(NOT_FOUND);
    if (group.ownerId !== userId) throw new ForbiddenException(OWNER_ONLY);
    return group;
  }

  /** Amis de `userId` à mettre dans un groupe (sans doublon ni lui-même). */
  private async validFriendIds(userId: string, memberIds: string[]) {
    const friendIds = [...new Set(memberIds)].filter((id) => id !== userId);
    if (friendIds.length === 0) {
      throw new BadRequestException('Choisissez au moins un ami');
    }
    if (!(await this.friendsService.areAllFriends(userId, friendIds))) {
      throw new BadRequestException('Un groupe ne peut réunir que vos amis');
    }
    return friendIds;
  }

  private toSummary(group: GroupWithMembers): GroupSummary {
    return {
      id: group.id,
      name: group.name,
      photoUrl: GroupPhotosService.url(group.photo),
      ownerId: group.ownerId,
      createdAt: group.createdAt.toISOString(),
      members: group.members.map((member) => member.user),
      call: this.ongoingCalls.get(groupKey(group.id)),
    };
  }
}

/** Membres d'un groupe, du plus ancien au plus récent. */
async function memberIdsOf(db: Db, groupId: string): Promise<string[]> {
  const members = await db.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
    orderBy: BY_SENIORITY,
  });
  return members.map((member) => member.userId);
}

/** Le membre le plus ancien devient propriétaire du groupe. */
async function handOver(db: Db, groupId: string) {
  const [successor] = await memberIdsOf(db, groupId);
  if (successor) {
    await db.group.update({
      where: { id: groupId },
      data: { ownerId: successor },
    });
  }
}
