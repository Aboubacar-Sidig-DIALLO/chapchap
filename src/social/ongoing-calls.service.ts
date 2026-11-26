import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { Conversation } from './conversation-access.service';
import type { OngoingCall, PublicUser } from './social.types';
import { toPublicUser } from './social.utils';

/** Un appel commence, change de participants ou prend fin (`call: null`). */
export interface OngoingCallUpdate {
  conversation: Conversation;
  call: OngoingCall | null;
  /** Celui qui vient de lancer l'appel ; `null` si l'appel existait déjà. */
  startedBy: PublicUser | null;
}

/** Refus d'un appel entre amis, demandé depuis l'accueil. */
export interface CallDecline {
  /** Conversation privée de celui qui refuse (clé calculée par le serveur). */
  conversationKey: string;
  userId: string;
}

/**
 * Appels en cours dans les conversations privées et de groupe, en mémoire :
 * de quoi les montrer sur l'accueil sans entrer dans la conversation, et faire
 * sonner les membres quand un appel commence.
 *
 * Le module d'appel le tient à jour ; l'accueil le lit et relaie ses
 * changements (`changes$`). Dans l'autre sens, l'accueil lui transmet les
 * refus d'appel (`declines$`), que le module d'appel applique.
 */
@Injectable()
export class OngoingCallsService {
  private readonly calls = new Map<string, OngoingCall>();
  readonly changes$ = new Subject<OngoingCallUpdate>();
  readonly declines$ = new Subject<CallDecline>();

  /** `userId` refuse l'appel en cours dans sa conversation `conversationKey`. */
  decline(conversationKey: string, userId: string) {
    if (this.calls.has(conversationKey)) {
      this.declines$.next({ conversationKey, userId });
    }
  }

  /** L'appel en cours dans la conversation `key`, s'il y en a un. */
  get(key: string): OngoingCall | null {
    return this.calls.get(key) ?? null;
  }

  /**
   * Enregistre les participants actuels de l'appel d'une conversation (liste
   * vide : l'appel est terminé). Ne signale que les vrais changements : un
   * micro coupé ou un deuxième onglet de la même personne ne changent rien ici.
   */
  update(
    conversation: Conversation,
    participants: { id: string; name: string }[],
    startedAt: string | null,
  ) {
    const previous = this.calls.get(conversation.key);
    const users = uniqueById(participants).map(toPublicUser);

    if (users.length === 0 || !startedAt) {
      if (!previous) return;
      this.calls.delete(conversation.key);
      this.changes$.next({ conversation, call: null, startedBy: null });
      return;
    }

    if (previous && sameUsers(previous.participants, users)) return;

    const call: OngoingCall = { startedAt, participants: users };
    this.calls.set(conversation.key, call);
    this.changes$.next({
      conversation,
      call,
      startedBy: previous ? null : users[0],
    });
  }
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function sameUsers(a: PublicUser[], b: PublicUser[]) {
  return (
    a.length === b.length && a.every((user, index) => user.id === b[index].id)
  );
}
