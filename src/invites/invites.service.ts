import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPrisma } from '../database/database.module';
import type { PrismaClient } from '../generated/prisma/client';
import { FriendsService } from '../social/friends.service';
import { GroupsService } from '../social/groups.service';
import { PUBLIC_USER_SELECT } from '../social/social.constants';
import type { PublicUser } from '../social/social.types';
import { type Invite, InviteStore } from './invite-store';
import type {
  CreatedInvite,
  InviteAcceptance,
  InvitePreview,
  InviteTarget,
} from './invites.types';

/** Même réponse pour un lien inconnu, expiré ou devenu caduc : rien à deviner. */
const INVITE_GONE =
  'Cette invitation a expiré. Demandez un nouveau lien à la personne qui vous l’a envoyé.';

/** Une invitation acceptée, et ceux à prévenir. */
export interface AcceptedInvite {
  conversation: InviteAcceptance;
  inviterId: string;
  /** Faux s'il était déjà ami ou membre : rien n'a changé. */
  changed: boolean;
  /** Invitation de groupe : son nom et ses membres, nouvel arrivant compris. */
  group: { id: string; name: string; memberIds: string[] } | null;
}

function toCreated(invite: Invite): CreatedInvite {
  return {
    token: invite.token,
    target: invite.target,
    expiresAt: new Date(invite.expiresAt).toISOString(),
  };
}

/**
 * Invitations par lien ou QR code, valables une minute : devenir ami avec
 * leur auteur, ou rejoindre un groupe. Tout est revérifié à l'acceptation
 * (l'auteur existe encore, a toujours le droit d'ajouter au groupe…).
 */
@Injectable()
export class InvitesService {
  private readonly store = new InviteStore();

  constructor(
    @InjectPrisma() private readonly prisma: PrismaClient,
    private readonly friendsService: FriendsService,
    private readonly groupsService: GroupsService,
  ) {}

  /** L'invitation de `userId` vers `target` (la même tant qu'elle vaut, sauf `renew`). */
  async create(
    userId: string,
    target: InviteTarget,
    renew: boolean,
  ): Promise<CreatedInvite> {
    if (target.type === 'group') {
      await this.groupsService.assertCanInvite(userId, target.groupId);
    }
    return toCreated(this.store.issue(userId, target, { renew }));
  }

  /** Désactive son invitation avant l'heure. */
  revoke(userId: string, token: string): void {
    this.store.revoke(token, userId);
  }

  /** L'invitation telle que la voit celui qui ouvre le lien. */
  async preview(userId: string, token: string): Promise<InvitePreview> {
    const invite = this.findOrGone(token);
    const inviter = await this.inviterOf(invite);
    const expiresAt = new Date(invite.expiresAt).toISOString();
    const isOwn = invite.creatorId === userId;

    if (invite.target.type === 'friend') {
      const isFriend =
        !isOwn &&
        (await this.friendsService.areAllFriends(userId, [inviter.id]));
      return {
        inviter,
        group: null,
        expiresAt,
        status: isOwn ? 'own' : isFriend ? 'done' : 'pending',
      };
    }

    const group = await this.groupsService.invitePreview(invite.target.groupId);
    if (!group) throw new GoneException(INVITE_GONE);
    const { memberIds, ...shown } = group;
    return {
      inviter,
      group: { ...shown, memberCount: memberIds.length },
      expiresAt,
      status: isOwn ? 'own' : memberIds.includes(userId) ? 'done' : 'pending',
    };
  }

  /** `userId` accepte : il devient ami de l'auteur, ou rejoint le groupe. */
  async accept(userId: string, token: string): Promise<AcceptedInvite> {
    const invite = this.findOrGone(token);
    if (invite.creatorId === userId) {
      throw new BadRequestException(
        'C’est votre propre invitation : partagez-la avec la personne à inviter',
      );
    }
    const inviter = await this.inviterOf(invite);

    if (invite.target.type === 'friend') {
      const { changed } = await this.friendsService.befriend(
        userId,
        inviter.id,
      );
      return {
        conversation: { type: 'direct', userId: inviter.id },
        inviterId: inviter.id,
        changed,
        group: null,
      };
    }

    const { groupId } = invite.target;
    const group = await this.groupsService.invitePreview(groupId);
    if (!group) throw new GoneException(INVITE_GONE);
    try {
      const { joined, memberIds } = await this.groupsService.joinByInvite(
        inviter.id,
        groupId,
        userId,
      );
      return {
        conversation: { type: 'group', groupId },
        inviterId: inviter.id,
        changed: joined,
        group: { id: groupId, name: group.name, memberIds },
      };
    } catch (error) {
      // L'auteur n'est plus membre, ou n'a plus le droit d'ajouter : le lien ne vaut plus.
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw new GoneException(INVITE_GONE);
      }
      throw error;
    }
  }

  private findOrGone(token: string): Invite {
    const invite = this.store.find(token);
    if (!invite) throw new GoneException(INVITE_GONE);
    return invite;
  }

  /** L'auteur de l'invitation, s'il existe encore (compte supprimé : le lien ne vaut plus). */
  private async inviterOf(invite: Invite): Promise<PublicUser> {
    const inviter = await this.prisma.user.findUnique({
      where: { id: invite.creatorId },
      select: PUBLIC_USER_SELECT,
    });
    if (!inviter) throw new GoneException(INVITE_GONE);
    return inviter;
  }
}
