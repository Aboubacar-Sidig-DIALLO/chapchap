import { prisma } from '../database/prisma';

/**
 * Qui connaît ce compte : ses amis et demandes en cours, et ses groupes. À lire
 * avant de supprimer le compte (la suppression efface ces liens en cascade),
 * pour prévenir ensuite les personnes concernées.
 */
export async function findAccountLinks(userId: string) {
  const [friendships, memberships] = await Promise.all([
    prisma.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { userAId: true, userBId: true },
    }),
    prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    }),
  ]);

  return {
    relatedUserIds: friendships.map((friendship) =>
      friendship.userAId === userId ? friendship.userBId : friendship.userAId,
    ),
    groupIds: memberships.map((membership) => membership.groupId),
  };
}
