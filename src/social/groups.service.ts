import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPrisma } from '../database/database.module';
import type {
  Prisma,
  PrismaClient,
  GroupRole as StoredRole,
} from '../generated/prisma/client';
import { groupKey } from './conversation-access.service';
import { FriendsService } from './friends.service';
import { GroupPhotosService } from './group-photos.service';
import {
  ALL_ALLOWED,
  groupPermissions,
  memberPermissions,
  roleOf,
  toStoredGroupPermissions,
  toStoredMemberPermissions,
} from './group-rights';
import { OngoingCallsService } from './ongoing-calls.service';
import { GROUP_MAX_MEMBERS, PUBLIC_USER_SELECT } from './social.constants';
import type { GroupPermissions, GroupSummary } from './social.types';

type Db = PrismaClient | Prisma.TransactionClient;

/** Ordre d'ancienneté des membres : le premier arrivé d'abord. */
const BY_SENIORITY = [
  { joinedAt: 'asc' },
  { userId: 'asc' },
] satisfies Prisma.GroupMemberOrderByWithRelationInput[];

const GROUP_INCLUDE = {
  members: {
    select: {
      userId: true,
      role: true,
      canWrite: true,
      canSendVoice: true,
      canCall: true,
      user: { select: PUBLIC_USER_SELECT },
    },
    orderBy: BY_SENIORITY,
  },
} satisfies Prisma.GroupInclude;

type GroupWithMembers = Prisma.GroupGetPayload<{
  include: typeof GROUP_INCLUDE;
}>;

/** Un groupe modifié, et ceux à prévenir. */
export interface GroupChange {
  group: GroupSummary;
  /** Nouveaux membres (ajout) : on leur annonce le groupe. */
  addedIds: string[];
}

/** Changement de rôle ou de restrictions d'un membre. */
export interface MemberUpdate {
  role?: 'admin' | 'member';
  permissions?: GroupPermissions;
}

const NOT_FOUND = 'Groupe introuvable';
const NOT_A_MEMBER = 'Cette personne ne fait plus partie du groupe';

/** Qui peut faire quoi : le propriétaire seul, ou aussi ses administrateurs. */
const REQUIRED_ROLE = {
  owner: {
    roles: ['owner'],
    error: 'Seul le propriétaire du groupe peut faire cela',
  },
  manager: {
    roles: ['owner', 'admin'],
    error:
      'Seuls le propriétaire et les administrateurs du groupe peuvent faire cela',
  },
} as const;

/**
 * Groupes d'amis. Chaque groupe a un propriétaire, toujours membre, qui le
 * renomme, change sa photo, gère ses membres, leurs rôles et leurs
 * autorisations. Ses administrateurs l'aident : ils ajoutent des membres et
 * suppriment des messages. Pour partir, le propriétaire désigne son
 * successeur ; le dernier à partir supprime le groupe.
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
   * membre, donne un nouveau propriétaire à ceux qu'il possédait (il n'a pas
   * pu le choisir), et renvoie les membres restants, chacun une fois.
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
    for (const group of ownerless)
      await appointSuccessor(this.prisma, group.id);

    const members = await this.prisma.groupMember.findMany({
      where: { groupId: { in: groupIds } },
      select: { userId: true },
      distinct: ['userId'],
    });
    return members.map((member) => member.userId);
  }

  /** Membres actuels d'un groupe (vide s'il n'existe plus). */
  async memberIds(groupId: string): Promise<string[]> {
    return memberIdsOf(this.prisma, groupId);
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

  /** Renomme le groupe (propriétaire). */
  async rename(
    userId: string,
    groupId: string,
    name: string,
  ): Promise<GroupSummary> {
    await this.require(this.prisma, userId, groupId, 'owner');
    return this.update(groupId, { name });
  }

  /**
   * Ce que tous les simples membres peuvent faire : écrire, envoyer des
   * vocaux, lancer un appel (propriétaire).
   */
  async setPermissions(
    userId: string,
    groupId: string,
    permissions: GroupPermissions,
  ): Promise<GroupSummary> {
    await this.require(this.prisma, userId, groupId, 'owner');
    return this.update(groupId, toStoredGroupPermissions(permissions));
  }

  /**
   * Remplace la photo du groupe (`bytes`), ou la retire (`null`).
   * Propriétaire ; l'ancienne photo est supprimée du disque.
   */
  async setPhoto(
    userId: string,
    groupId: string,
    bytes: Buffer | null,
  ): Promise<GroupSummary> {
    // Vérifié avant d'écrire quoi que ce soit sur le disque.
    const { photo: previous } = await this.require(
      this.prisma,
      userId,
      groupId,
      'owner',
    );
    const photo = bytes ? await this.groupPhotos.save(bytes) : null;

    try {
      const group = await this.update(groupId, { photo });
      await this.groupPhotos.remove(previous);
      return group;
    } catch (error) {
      await this.groupPhotos.remove(photo);
      throw error;
    }
  }

  /**
   * Ajoute au groupe des amis de celui qui ajoute (propriétaire ou
   * administrateur).
   */
  async addMembers(
    userId: string,
    groupId: string,
    memberIds: string[],
  ): Promise<GroupChange> {
    const friendIds = await this.validFriendIds(userId, memberIds);

    const addedIds = await this.prisma.$transaction(async (tx) => {
      await this.require(tx, userId, groupId, 'manager');
      const currentIds = new Set(await memberIdsOf(tx, groupId));
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
   * Vérifie que `userId` peut inviter dans le groupe par un lien : les mêmes
   * que ceux qui ajoutent des membres (propriétaire ou administrateur).
   */
  async assertCanInvite(userId: string, groupId: string): Promise<void> {
    await this.require(this.prisma, userId, groupId, 'manager');
  }

  /** Ce qu'on montre du groupe à qui reçoit une invitation ; `null` s'il n'existe plus. */
  async invitePreview(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        photo: true,
        members: { select: { userId: true } },
      },
    });
    if (!group) return null;
    return {
      id: group.id,
      name: group.name,
      photoUrl: GroupPhotosService.url(group.photo),
      memberIds: group.members.map((member) => member.userId),
    };
  }

  /**
   * `userId` rejoint le groupe grâce à l'invitation de `inviterId`, qui doit
   * toujours pouvoir y ajouter des membres (ses droits ont pu changer depuis).
   * Sans effet s'il en fait déjà partie (`joined: false`).
   */
  async joinByInvite(
    inviterId: string,
    groupId: string,
    userId: string,
  ): Promise<{ joined: boolean; memberIds: string[] }> {
    return this.prisma.$transaction(async (tx) => {
      await this.require(tx, inviterId, groupId, 'manager');
      const memberIds = await memberIdsOf(tx, groupId);
      if (memberIds.includes(userId)) return { joined: false, memberIds };
      if (memberIds.length >= GROUP_MAX_MEMBERS) {
        throw new BadRequestException(
          `Ce groupe est complet (${GROUP_MAX_MEMBERS} membres au plus)`,
        );
      }
      await tx.groupMember.create({ data: { groupId, userId } });
      return { joined: true, memberIds: [...memberIds, userId] };
    });
  }

  /**
   * Nomme ou destitue un administrateur, ou règle les restrictions d'un
   * membre (propriétaire). Un administrateur n'est jamais restreint : le
   * nommer lève ses restrictions personnelles.
   */
  async updateMember(
    userId: string,
    groupId: string,
    memberId: string,
    { role, permissions }: MemberUpdate,
  ): Promise<GroupSummary> {
    if (memberId === userId) {
      throw new BadRequestException(
        'Le propriétaire a toujours tous les droits sur son groupe',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.require(tx, userId, groupId, 'owner');
      const member = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId, userId: memberId } },
        select: { role: true },
      });
      if (!member) throw new NotFoundException(NOT_A_MEMBER);

      const nextRole: StoredRole =
        role === undefined
          ? member.role
          : role === 'admin'
            ? 'ADMIN'
            : 'MEMBER';
      if (permissions && nextRole === 'ADMIN') {
        throw new BadRequestException(
          "Un administrateur n'est jamais restreint : retirez-lui d'abord ce rôle",
        );
      }
      await tx.groupMember.update({
        where: { groupId_userId: { groupId, userId: memberId } },
        data: {
          role: nextRole,
          ...(nextRole === 'ADMIN' && toStoredMemberPermissions(ALL_ALLOWED)),
          ...(permissions && toStoredMemberPermissions(permissions)),
        },
      });
    });
    return this.get(userId, groupId);
  }

  /**
   * Retire un membre du groupe (propriétaire, qui ne peut pas se retirer
   * lui-même : il quitte le groupe). Renvoie les membres restants.
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
      await this.require(tx, userId, groupId, 'owner');
      const { count } = await tx.groupMember.deleteMany({
        where: { groupId, userId: memberId },
      });
      if (count === 0) throw new NotFoundException(NOT_A_MEMBER);
      return memberIdsOf(tx, groupId);
    });
  }

  /**
   * Quitte un groupe. Le propriétaire désigne son successeur (`successorId`),
   * obligatoire tant qu'il reste quelqu'un ; le dernier à partir supprime le
   * groupe (et sa photo). Renvoie les membres restants, à prévenir.
   */
  async leave(
    userId: string,
    groupId: string,
    successorId?: string,
  ): Promise<string[]> {
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
        if (group.ownerId === userId) {
          await transferOwnership(tx, groupId, remaining, successorId);
        }
        return { remaining, deletedPhoto: null };
      },
    );

    await this.groupPhotos.remove(deletedPhoto);
    return remaining;
  }

  private async update(
    groupId: string,
    data: Prisma.GroupUpdateInput,
  ): Promise<GroupSummary> {
    const group = await this.prisma.group.update({
      where: { id: groupId },
      data,
      include: GROUP_INCLUDE,
    });
    return this.toSummary(group);
  }

  /**
   * Le groupe, si `userId` y a le rôle requis ; sinon une erreur explicite
   * (introuvable pour qui n'en est pas membre).
   */
  private async require(
    db: Db,
    userId: string,
    groupId: string,
    required: keyof typeof REQUIRED_ROLE,
  ) {
    const member = await db.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: {
        userId: true,
        role: true,
        group: { select: { ownerId: true, photo: true } },
      },
    });
    if (!member) throw new NotFoundException(NOT_FOUND);

    const { roles, error } = REQUIRED_ROLE[required];
    const role = roleOf(member.group.ownerId, member);
    if (!(roles as readonly string[]).includes(role)) {
      throw new ForbiddenException(error);
    }
    return member.group;
  }

  /** Amis de `userId` à mettre dans un groupe (sans doublon ni lui-même). */
  private async validFriendIds(userId: string, memberIds: string[]) {
    const friendIds = [...new Set(memberIds)].filter((id) => id !== userId);
    if (friendIds.length === 0) {
      throw new BadRequestException('Choisissez au moins un ami');
    }
    if (!(await this.friendsService.areAllFriends(userId, friendIds))) {
      throw new BadRequestException('Vous ne pouvez ajouter que vos amis');
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
      members: group.members.map((member) => ({
        ...member.user,
        role: roleOf(group.ownerId, member),
        permissions: memberPermissions(member),
      })),
      permissions: groupPermissions(group),
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

/**
 * Le propriétaire part : `successorId`, l'un des membres restants, prend sa
 * place. Devenu propriétaire, il n'a plus besoin d'un rôle ni de restrictions.
 */
async function transferOwnership(
  db: Db,
  groupId: string,
  remainingIds: string[],
  successorId: string | undefined,
) {
  if (!successorId) {
    throw new BadRequestException(
      'Choisissez le nouveau propriétaire du groupe avant de partir',
    );
  }
  if (!remainingIds.includes(successorId)) {
    throw new BadRequestException(
      'Le nouveau propriétaire doit faire partie du groupe',
    );
  }
  await makeOwner(db, groupId, successorId);
}

/**
 * Le propriétaire a disparu sans choisir (compte supprimé) : son plus ancien
 * administrateur lui succède, à défaut le membre le plus ancien.
 */
async function appointSuccessor(db: Db, groupId: string) {
  const successor =
    (await db.groupMember.findFirst({
      where: { groupId, role: 'ADMIN' },
      select: { userId: true },
      orderBy: BY_SENIORITY,
    })) ??
    (await db.groupMember.findFirst({
      where: { groupId },
      select: { userId: true },
      orderBy: BY_SENIORITY,
    }));
  if (successor) await makeOwner(db, groupId, successor.userId);
}

async function makeOwner(db: Db, groupId: string, userId: string) {
  await db.group.update({ where: { id: groupId }, data: { ownerId: userId } });
  await db.groupMember.update({
    where: { groupId_userId: { groupId, userId } },
    data: { role: 'MEMBER', ...toStoredMemberPermissions(ALL_ALLOWED) },
  });
}
