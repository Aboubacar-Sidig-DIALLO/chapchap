import { Injectable } from '@nestjs/common';
import { InjectPrisma } from '../database/database.module';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { PresenceService } from '../social/presence.service';
import { ADMIN_PAGE_SIZE, type ListUsersQuery } from './admin.schemas';
import type { AdminStats, AdminUser, AdminUserPage } from './admin.types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Suspension en cours : une suspension échue est levée à la prochaine connexion. */
function activeBan(now: Date): Prisma.UserWhereInput {
  return {
    banned: true,
    OR: [{ banExpires: null }, { banExpires: { gt: now } }],
  };
}

const ORDER_BY = {
  newest: { createdAt: 'desc' },
  oldest: { createdAt: 'asc' },
  name: { name: 'asc' },
} satisfies Record<ListUsersQuery['sort'], Prisma.UserOrderByWithRelationInput>;

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  role: true,
  banned: true,
  banReason: true,
  banExpires: true,
  createdAt: true,
  lastSeenAt: true,
} satisfies Prisma.UserSelect;

/**
 * Lecture des comptes pour l'administration. Les modifications passent par
 * le plugin Admin de Better Auth, qui en vérifie les droits.
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectPrisma() private readonly prisma: PrismaClient,
    private readonly presence: PresenceService,
  ) {}

  async stats(): Promise<AdminStats> {
    const now = new Date();
    const [users, admins, banned, newThisWeek] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: 'admin' } }),
      this.prisma.user.count({ where: activeBan(now) }),
      this.prisma.user.count({
        where: { createdAt: { gte: new Date(now.getTime() - WEEK_MS) } },
      }),
    ]);
    return {
      users,
      online: this.presence.onlineCount(),
      admins,
      banned,
      newThisWeek,
    };
  }

  /** Une page de comptes, recherchés dans le nom et l'adresse. */
  async listUsers({
    search,
    filter,
    sort,
    page,
  }: ListUsersQuery): Promise<AdminUserPage> {
    const now = new Date();
    const where: Prisma.UserWhereInput = {
      AND: [
        search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
        filter === 'online' ? { id: { in: this.presence.onlineIds() } } : {},
        filter === 'admins' ? { role: 'admin' } : {},
        filter === 'banned' ? activeBan(now) : {},
      ],
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: [ORDER_BY[sort], { id: 'asc' }],
        skip: (page - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users: users.map((user): AdminUser => {
        const isBanned =
          user.banned === true &&
          (user.banExpires === null || user.banExpires > now);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role === 'admin' ? 'admin' : 'user',
          banned: isBanned,
          banReason: isBanned ? user.banReason : null,
          banExpires: isBanned
            ? (user.banExpires?.toISOString() ?? null)
            : null,
          online: this.presence.isOnline(user.id),
          createdAt: user.createdAt.toISOString(),
          lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
        };
      }),
      total,
      page,
      pageSize: ADMIN_PAGE_SIZE,
    };
  }
}
