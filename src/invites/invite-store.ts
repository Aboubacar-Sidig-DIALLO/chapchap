import { randomBytes } from 'node:crypto';
import { INVITE_TOKEN_BYTES, INVITE_TTL_MS } from './invites.constants';
import type { InviteTarget } from './invites.types';

export interface Invite {
  token: string;
  creatorId: string;
  target: InviteTarget;
  /** Horodatage (ms) d'expiration. */
  expiresAt: number;
}

function randomToken() {
  return randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
}

/** Une seule invitation active par auteur et par cible (lui-même, ou tel groupe). */
function slotOf(creatorId: string, target: InviteTarget) {
  return target.type === 'friend'
    ? `${creatorId}:friend`
    : `${creatorId}:group:${target.groupId}`;
}

/**
 * Invitations en cours, en mémoire uniquement et pour une minute : rien
 * n'est écrit en base, un redémarrage les efface toutes. Chaque auteur n'a
 * qu'une invitation active par cible, ce qui borne la mémoire utilisée.
 */
export class InviteStore {
  private readonly byToken = new Map<string, Invite>();
  private readonly tokenBySlot = new Map<string, string>();

  constructor(private readonly generateToken: () => string = randomToken) {}

  /**
   * L'invitation de `creatorId` vers `target` : celle encore valable s'il y
   * en a une (rouvrir la fenêtre réaffiche le même QR code), sinon une
   * nouvelle. `renew` remplace l'ancienne : son lien cesse aussitôt de marcher.
   */
  issue(
    creatorId: string,
    target: InviteTarget,
    { renew = false, now = Date.now() } = {},
  ): Invite {
    this.prune(now);
    const slot = slotOf(creatorId, target);
    const current = this.liveByToken(this.tokenBySlot.get(slot), now);
    if (current && !renew) return current;
    if (current) this.delete(current);

    const invite: Invite = {
      token: this.generateToken(),
      creatorId,
      target,
      expiresAt: now + INVITE_TTL_MS,
    };
    this.byToken.set(invite.token, invite);
    this.tokenBySlot.set(slot, invite.token);
    return invite;
  }

  /** L'invitation de ce jeton, si elle n'a pas expiré. */
  find(token: string, now = Date.now()): Invite | undefined {
    return this.liveByToken(token, now);
  }

  /** Son auteur la désactive avant l'heure ; `false` si elle n'est pas (ou plus) à lui. */
  revoke(token: string, creatorId: string): boolean {
    const invite = this.byToken.get(token);
    if (!invite || invite.creatorId !== creatorId) return false;
    this.delete(invite);
    return true;
  }

  /** Oublie les invitations expirées. */
  prune(now = Date.now()) {
    for (const invite of this.byToken.values()) {
      if (invite.expiresAt <= now) this.delete(invite);
    }
  }

  private liveByToken(token: string | undefined, now: number) {
    const invite = token ? this.byToken.get(token) : undefined;
    if (!invite) return undefined;
    if (invite.expiresAt > now) return invite;
    this.delete(invite);
    return undefined;
  }

  private delete(invite: Invite) {
    this.byToken.delete(invite.token);
    const slot = slotOf(invite.creatorId, invite.target);
    if (this.tokenBySlot.get(slot) === invite.token) {
      this.tokenBySlot.delete(slot);
    }
  }
}
