import { Injectable } from '@nestjs/common';
import type { ChatUser } from '../chat/chat.types';
import {
  BURST_ALLOWANCE_MS,
  MAX_TALK_MS,
  TALKIE_BYTES_PER_SECOND,
} from './talkie.constants';

/** La prise de parole en cours dans une conversation. */
export interface Talk {
  /** Id du vocal qui suivra (fixé par le client). */
  id: string;
  /** Connexion (onglet) de l'orateur. */
  socketId: string;
  user: ChatUser;
  startedAt: number;
  receivedBytes: number;
  /**
   * Participants en heures calmes : la voix ne leur est pas relayée (ils
   * recevront le vocal). Complétée si l'un d'eux arrive en cours de route.
   */
  quietUserIds: string[];
}

export type ClaimResult =
  { ok: true; talk: Talk } | { ok: false; speaker: ChatUser };

/** `over` : débit ou durée dépassés, la prise de parole doit prendre fin. */
export type ChunkVerdict = 'ok' | 'ignored' | 'over';

/**
 * Le canal talkie-walkie de chaque conversation, en mémoire : une seule
 * voix à la fois, comme un vrai talkie-walkie. Le son lui-même n'est jamais
 * conservé, seulement relayé.
 */
@Injectable()
export class TalkieService {
  private readonly talks = new Map<string, Talk>();

  current(conversationKey: string): Talk | null {
    return this.talks.get(conversationKey) ?? null;
  }

  /**
   * Prend la parole. Une nouvelle demande de la même connexion remplace la
   * précédente ; celle de quelqu'un d'autre est refusée tant qu'il parle.
   */
  claim(
    conversationKey: string,
    socketId: string,
    user: ChatUser,
    id: string,
    {
      quietUserIds = [],
      now = Date.now(),
    }: { quietUserIds?: string[]; now?: number } = {},
  ): ClaimResult {
    const current = this.talks.get(conversationKey);
    if (current && current.socketId !== socketId) {
      return { ok: false, speaker: current.user };
    }

    const talk: Talk = {
      id,
      socketId,
      user,
      startedAt: now,
      receivedBytes: 0,
      quietUserIds,
    };
    this.talks.set(conversationKey, talk);
    return { ok: true, talk };
  }

  /**
   * Vérifie un morceau de son avant de le relayer : il doit venir de
   * l'orateur, et rester dans le débit d'une voix (avec une petite avance
   * tolérée) et dans la durée maximale.
   */
  accept(
    conversationKey: string,
    socketId: string,
    bytes: number,
    now = Date.now(),
  ): ChunkVerdict {
    const talk = this.talks.get(conversationKey);
    if (talk?.socketId !== socketId) return 'ignored';

    const elapsedMs = now - talk.startedAt;
    const budget =
      ((elapsedMs + BURST_ALLOWANCE_MS) / 1000) * TALKIE_BYTES_PER_SECOND;
    talk.receivedBytes += bytes;

    if (elapsedMs > MAX_TALK_MS || talk.receivedBytes > budget) return 'over';
    return 'ok';
  }

  /** Rend la parole ; renvoie la prise de parole terminée (si cette connexion l'avait). */
  release(conversationKey: string, socketId: string): Talk | null {
    const talk = this.talks.get(conversationKey);
    if (talk?.socketId !== socketId) return null;

    this.talks.delete(conversationKey);
    return talk;
  }
}
