import { randomBytes, randomUUID } from 'node:crypto';
import type { ChatUser } from '../../chat/chat.types';
import {
  GUEST_LINK_TTL_MS,
  GUEST_TOKEN_BYTES,
  MAX_GUESTS_PER_CALL,
} from './call-guests.constants';

/** Lien d'invité pas encore utilisé. */
export interface GuestLink {
  token: string;
  /** Conversation du groupe dont l'appel est ouvert à l'invité. */
  conversationKey: string;
  groupId: string;
  inviterId: string;
  /** Nom de celui qui invite, montré à l'invité avant d'entrer. */
  inviterName: string;
  /** Horodatage (ms) au-delà duquel le lien ne marche plus. */
  expiresAt: number;
}

/**
 * Laissez-passer remis à l'invité en échange du lien (qui disparaît alors) :
 * son identité dans l'appel, valable jusqu'à la fin de celui-ci. Il permet de
 * revenir après une coupure, sans que le lien serve à quelqu'un d'autre.
 */
export interface GuestPass {
  pass: string;
  guest: ChatUser;
  conversationKey: string;
  groupId: string;
  inviterId: string;
}

function randomToken() {
  return randomBytes(GUEST_TOKEN_BYTES).toString('base64url');
}

/**
 * Liens et laissez-passer des invités d'appel, en mémoire seulement : un
 * redémarrage du serveur les efface, comme les appels eux-mêmes.
 */
export class GuestPassStore {
  private readonly links = new Map<string, GuestLink>();
  private readonly passes = new Map<string, GuestPass>();

  constructor(private readonly generateToken: () => string = randomToken) {}

  /**
   * Nouveau lien à usage unique, ou `null` si l'appel a déjà son compte
   * d'invités (présents et liens en attente confondus).
   */
  createLink(
    link: Omit<GuestLink, 'token' | 'expiresAt'>,
    now = Date.now(),
  ): GuestLink | null {
    this.prune(now);
    if (this.guestCount(link.conversationKey) >= MAX_GUESTS_PER_CALL) {
      return null;
    }
    const created = {
      ...link,
      token: this.generateToken(),
      expiresAt: now + GUEST_LINK_TTL_MS,
    };
    this.links.set(created.token, created);
    return created;
  }

  findLink(token: string, now = Date.now()): GuestLink | undefined {
    const link = this.links.get(token);
    if (!link || link.expiresAt > now) return link;
    this.links.delete(token);
    return undefined;
  }

  /**
   * Utilise le lien, une fois pour toutes : il disparaît, et l'invité reçoit
   * son laissez-passer. `null` si le lien n'existe pas (ou plus).
   */
  claim(token: string, name: string, now = Date.now()): GuestPass | null {
    const link = this.findLink(token, now);
    if (!link) return null;
    this.links.delete(token);

    const pass: GuestPass = {
      pass: this.generateToken(),
      guest: { id: `guest:${randomUUID()}`, name, isGuest: true },
      conversationKey: link.conversationKey,
      groupId: link.groupId,
      inviterId: link.inviterId,
    };
    this.passes.set(pass.pass, pass);
    return pass;
  }

  findPass(pass: string): GuestPass | undefined {
    return this.passes.get(pass);
  }

  /** L'auteur du lien le retire avant qu'il serve ; `false` s'il n'est pas (ou plus) à lui. */
  revokeLink(token: string, inviterId: string): boolean {
    const link = this.links.get(token);
    if (!link || link.inviterId !== inviterId) return false;
    return this.links.delete(token);
  }

  /** L'invité est retiré de l'appel : son laissez-passer ne vaut plus rien. */
  revokeGuest(guestId: string) {
    for (const [key, pass] of this.passes) {
      if (pass.guest.id === guestId) this.passes.delete(key);
    }
  }

  /** L'appel est terminé : liens et laissez-passer de ses invités disparaissent. */
  revokeConversation(conversationKey: string) {
    for (const [token, link] of this.links) {
      if (link.conversationKey === conversationKey) this.links.delete(token);
    }
    for (const [key, pass] of this.passes) {
      if (pass.conversationKey === conversationKey) this.passes.delete(key);
    }
  }

  /** Invités de l'appel : présents (ou partis un instant) et liens en attente. */
  private guestCount(conversationKey: string) {
    const count = (items: Iterable<{ conversationKey: string }>) =>
      [...items].filter((item) => item.conversationKey === conversationKey)
        .length;
    return count(this.links.values()) + count(this.passes.values());
  }

  private prune(now: number) {
    for (const [token, link] of this.links) {
      if (link.expiresAt <= now) this.links.delete(token);
    }
  }
}
