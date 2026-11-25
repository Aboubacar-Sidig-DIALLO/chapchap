import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPrisma } from '../database/database.module';
import {
  FriendshipStatus,
  type Friendship,
  type PrismaClient,
} from '../generated/prisma/client';
import { PrismaClientKnownRequestError } from '../generated/prisma/internal/prismaNamespace';
import { directKey } from './conversation-access.service';
import { OngoingCallsService } from './ongoing-calls.service';
import { PresenceService } from './presence.service';
import { PUBLIC_USER_SELECT, SEARCH_MAX_RESULTS } from './social.constants';
import { pairOf } from './social.utils';
import type {
  FriendshipChange,
  FriendsOverview,
  PublicUser,
  Relation,
  SearchResult,
} from './social.types';

function relationOf(
  friendship: Pick<Friendship, 'status' | 'requesterId'> | null,
  userId: string,
): Relation {
  if (!friendship) return 'none';
  if (friendship.status === FriendshipStatus.ACCEPTED) return 'friend';
  return friendship.requesterId === userId ? 'outgoing' : 'incoming';
}

/** Tous les liens d'amitié qui impliquent `userId`. */
function involving(userId: string) {
  return { OR: [{ userAId: userId }, { userBId: userId }] };
}

/** `contains` s'appuie sur `LIKE` : `%` et `_` y sont des jokers, à prendre ici au pied de la lettre. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}

const byName = (a: PublicUser, b: PublicUser) =>
  a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });

@Injectable()
export class FriendsService {
  constructor(
    @InjectPrisma() private readonly prisma: PrismaClient,
    private readonly presence: PresenceService,
    private readonly ongoingCalls: OngoingCallsService,
  ) {}

  /** Identifiants des amis de `userId` (demandes acceptées). */
  async friendIds(userId: string): Promise<string[]> {
    const friendships = await this.prisma.friendship.findMany({
      where: { status: FriendshipStatus.ACCEPTED, ...involving(userId) },
      select: { userAId: true, userBId: true },
    });
    return friendships.map((f) =>
      f.userAId === userId ? f.userBId : f.userAId,
    );
  }

  /** Recherche par nom (hors soi-même), avec le lien que l'on a avec chacun. */
  async search(userId: string, query: string): Promise<SearchResult[]> {
    const users = await this.prisma.user.findMany({
      where: {
        id: { not: userId },
        name: { contains: escapeLike(query), mode: 'insensitive' },
      },
      select: PUBLIC_USER_SELECT,
      orderBy: { name: 'asc' },
      take: SEARCH_MAX_RESULTS,
    });
    if (users.length === 0) return [];

    const ids = users.map((user) => user.id);
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: userId, userBId: { in: ids } },
          { userBId: userId, userAId: { in: ids } },
        ],
      },
    });
    const byOtherId = new Map(
      friendships.map((f) => [f.userAId === userId ? f.userBId : f.userAId, f]),
    );

    return users.map((user) => ({
      ...user,
      relation: relationOf(byOtherId.get(user.id) ?? null, userId),
    }));
  }

  /** Amis, demandes reçues et demandes envoyées. */
  async overview(userId: string): Promise<FriendsOverview> {
    const userSelect = { ...PUBLIC_USER_SELECT, lastSeenAt: true } as const;
    const friendships = await this.prisma.friendship.findMany({
      where: involving(userId),
      include: {
        userA: { select: userSelect },
        userB: { select: userSelect },
      },
    });

    const overview: FriendsOverview = {
      friends: [],
      incoming: [],
      outgoing: [],
    };
    for (const friendship of friendships) {
      const { lastSeenAt, ...other } =
        friendship.userAId === userId ? friendship.userB : friendship.userA;
      const relation = relationOf(friendship, userId);
      // La présence n'est montrée qu'aux amis, jamais pour une simple demande.
      if (relation === 'friend') {
        const online = this.presence.isOnline(other.id);
        overview.friends.push({
          ...other,
          presence: {
            online,
            lastSeenAt: online ? null : (lastSeenAt?.toISOString() ?? null),
          },
          call: this.ongoingCalls.get(directKey(userId, other.id)),
        });
      } else if (relation === 'incoming') overview.incoming.push(other);
      else overview.outgoing.push(other);
    }

    overview.friends.sort(byName);
    overview.incoming.sort(byName);
    overview.outgoing.sort(byName);
    return overview;
  }

  /**
   * Demande `otherId` en ami. S'il nous avait déjà fait une demande, c'est
   * une acceptation : vous devenez amis.
   */
  async addFriend(userId: string, otherId: string): Promise<FriendshipChange> {
    if (otherId === userId) {
      throw new BadRequestException(
        'Vous ne pouvez pas vous ajouter vous-même',
      );
    }
    const other = await this.prisma.user.findUnique({
      where: { id: otherId },
      select: { id: true },
    });
    if (!other) throw new NotFoundException('Utilisateur introuvable');

    const pair = pairOf(userId, otherId);
    const existing = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: pair },
    });

    if (!existing) {
      try {
        await this.prisma.friendship.create({
          data: { ...pair, requesterId: userId },
        });
        return { relation: 'outgoing', changed: true };
      } catch (error) {
        // Demande croisée au même instant : on repart du lien créé par l'autre.
        if (isUniqueViolation(error)) return this.addFriend(userId, otherId);
        throw error;
      }
    }

    if (relationOf(existing, userId) === 'incoming') {
      await this.prisma.friendship.update({
        where: { id: existing.id },
        data: { status: FriendshipStatus.ACCEPTED },
      });
      return { relation: 'friend', changed: true };
    }
    return { relation: relationOf(existing, userId), changed: false };
  }

  /**
   * Supprime le lien avec `otherId`, quel qu'il soit : retire un ami,
   * refuse une demande reçue ou annule une demande envoyée.
   */
  async removeFriend(
    userId: string,
    otherId: string,
  ): Promise<FriendshipChange> {
    const { count } = await this.prisma.friendship.deleteMany({
      where: pairOf(userId, otherId),
    });
    return { relation: 'none', changed: count > 0 };
  }

  /** `true` si tous les `otherIds` sont amis avec `userId`. */
  async areAllFriends(userId: string, otherIds: string[]): Promise<boolean> {
    const count = await this.prisma.friendship.count({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { userAId: userId, userBId: { in: otherIds } },
          { userBId: userId, userAId: { in: otherIds } },
        ],
      },
    });
    return count === otherIds.length;
  }
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof PrismaClientKnownRequestError && error.code === 'P2002'
  );
}
