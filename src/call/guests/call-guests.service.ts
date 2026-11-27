import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Subscription } from 'rxjs';
import type { ChatUser } from '../../chat/chat.types';
import { groupKey } from '../../social/conversation-access.service';
import { GroupsService } from '../../social/groups.service';
import { CallTransport } from '../call-transport';
import { CallCoordinator } from '../call.coordinator';
import { CallService, type CallRoom } from '../call.service';
import { MAX_GUESTS_PER_CALL } from './call-guests.constants';
import type {
  CreatedGuestLink,
  GuestClaim,
  GuestLinkPreview,
} from './call-guests.types';
import { type GuestPass, GuestPassStore } from './guest-pass-store';

/** Même réponse pour un lien inconnu, déjà utilisé, expiré, ou un appel terminé : rien à deviner. */
const LINK_GONE =
  'Ce lien n’est plus valable : il a déjà servi, ou l’appel est terminé.';

/**
 * Invités d'un appel de groupe, sans compte : le temps de l'appel seulement.
 *
 * Le propriétaire ou un administrateur, présent dans l'appel, crée un lien
 * à usage unique. L'invité qui l'ouvre choisit un nom et reçoit en échange
 * un laissez-passer, qui le connecte à l'appel, et à rien d'autre (ni
 * messages, ni groupe). Quand l'appel prend fin, liens et laissez-passer
 * disparaissent ; un administrateur peut aussi retirer un invité à tout moment.
 */
@Injectable()
export class CallGuestsService implements OnModuleInit, OnModuleDestroy {
  private readonly store = new GuestPassStore();
  private subscription?: Subscription;

  constructor(
    private readonly callService: CallService,
    private readonly coordinator: CallCoordinator,
    private readonly transport: CallTransport,
    private readonly groupsService: GroupsService,
  ) {}

  /** Fin d'un appel : ses invités sont congédiés, leurs accès effacés. */
  onModuleInit() {
    this.subscription = this.coordinator.ended$.subscribe((key) => {
      this.store.revokeConversation(key);
      this.transport.dismissGuests(key);
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  /** Nouveau lien d'invité, par un propriétaire ou administrateur présent dans l'appel du groupe. */
  async createLink(
    inviter: ChatUser,
    groupId: string,
  ): Promise<CreatedGuestLink> {
    await this.groupsService.assertCanInvite(inviter.id, groupId);
    const room = this.liveCall(groupKey(groupId));
    if (!room?.hasUser(inviter.id)) {
      throw new BadRequestException(
        'Rejoignez l’appel du groupe pour y inviter quelqu’un',
      );
    }
    const link = this.store.createLink({
      conversationKey: room.key,
      groupId,
      inviterId: inviter.id,
      inviterName: inviter.name,
    });
    if (!link) {
      throw new ConflictException(
        `Un appel accueille au plus ${MAX_GUESTS_PER_CALL} invités`,
      );
    }
    return {
      token: link.token,
      expiresAt: new Date(link.expiresAt).toISOString(),
    };
  }

  /** Son auteur retire un lien encore inutilisé. */
  revokeLink(userId: string, token: string): void {
    this.store.revokeLink(token, userId);
  }

  /** Ce que voit l'invité avant d'entrer. */
  async preview(token: string): Promise<GuestLinkPreview> {
    const link = this.store.findLink(token);
    const room = link && this.liveCall(link.conversationKey);
    if (!link || !room) throw new GoneException(LINK_GONE);
    return {
      group: await this.groupOf(link.groupId),
      inviterName: link.inviterName,
      participantCount: room.list().length,
    };
  }

  /** L'invité utilise le lien (une fois pour toutes) et reçoit son laissez-passer. */
  async claim(token: string, name: string): Promise<GuestClaim> {
    const link = this.store.findLink(token);
    const room = link && this.liveCall(link.conversationKey);
    if (!link || !room) throw new GoneException(LINK_GONE);
    if (room.isFull()) {
      throw new ConflictException('L’appel est complet pour le moment');
    }
    const group = await this.groupOf(link.groupId);

    // Pris maintenant, sans attente : deux ouvertures simultanées n'en obtiennent qu'un.
    const pass = this.store.claim(token, name);
    if (!pass) throw new GoneException(LINK_GONE);
    return { pass: pass.pass, guest: pass.guest, group };
  }

  /** Le laissez-passer, et l'appel où il mène, s'il vaut encore. */
  authenticate(pass: string): { pass: GuestPass; room: CallRoom } | null {
    const found = this.store.findPass(pass);
    const room = found && this.liveCall(found.conversationKey);
    return found && room ? { pass: found, room } : null;
  }

  /**
   * Retire l'invité `peerId` de l'appel `key` (décision d'un modérateur,
   * vérifiée par l'appelant) : il ne peut plus revenir. `false` si ce n'est
   * pas un invité de cet appel.
   */
  removeGuest(key: string, peerId: string): boolean {
    const participant = this.callService.find(key)?.get(peerId);
    if (!participant?.user.isGuest) return false;
    this.store.revokeGuest(participant.user.id);
    this.transport.removeGuest(peerId);
    this.coordinator.leave(key, peerId);
    return true;
  }

  /** L'appel en cours dans cette conversation, s'il y reste au moins un membre. */
  private liveCall(key: string): CallRoom | null {
    const room = this.callService.find(key);
    return room?.hasMembers() ? room : null;
  }

  private async groupOf(groupId: string) {
    const group = await this.groupsService.invitePreview(groupId);
    if (!group) throw new GoneException(LINK_GONE);
    return { name: group.name, photoUrl: group.photoUrl };
  }
}
