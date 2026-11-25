import { Injectable } from '@nestjs/common';
import type { ChatUser } from '../chat/chat.types';
import type { CallMedia, CallParticipant, CallSummary } from './call.types';

/** Au-delà, la connexion en maillage (chacun envoie à chacun) sature les réseaux mobiles. */
export const MAX_CALL_PARTICIPANTS = 8;

/** Ce que l'on retient d'un direct en cours, pour sa trace. */
interface CallHistory {
  startedAt: string;
  /** Par identifiant d'utilisateur, dans l'ordre d'arrivée. */
  users: Map<string, ChatUser>;
  hadVideo: boolean;
}

/** Le direct d'une conversation : qui y est, avec quel média, et son histoire. */
class CallRoom {
  private readonly participants = new Map<string, CallParticipant>();
  private history: CallHistory | null = null;

  list(): CallParticipant[] {
    return [...this.participants.values()];
  }

  has(peerId: string): boolean {
    return this.participants.has(peerId);
  }

  isFull(): boolean {
    return this.participants.size >= MAX_CALL_PARTICIPANTS;
  }

  isEmpty(): boolean {
    return this.participants.size === 0;
  }

  /** Date ISO 8601 du début du direct en cours ; `null` s'il n'y en a pas. */
  startedAt(): string | null {
    return this.history?.startedAt ?? null;
  }

  /** Ajoute le participant ; retourne ceux qui étaient déjà là (à qui il se connecte). */
  join(peerId: string, user: ChatUser, media: CallMedia): CallParticipant[] {
    const others = this.list().filter((item) => item.peerId !== peerId);

    this.history ??= {
      startedAt: new Date().toISOString(),
      users: new Map(),
      hadVideo: false,
    };
    if (!this.history.users.has(user.id)) this.history.users.set(user.id, user);
    if (media.video) this.history.hadVideo = true;

    this.participants.set(peerId, {
      peerId,
      user,
      ...media,
      joinedAt:
        this.participants.get(peerId)?.joinedAt ?? new Date().toISOString(),
    });
    return others;
  }

  /** `true` si le participant était dans le direct. */
  leave(peerId: string): boolean {
    return this.participants.delete(peerId);
  }

  /** `true` si quelque chose a changé. */
  setMedia(peerId: string, media: CallMedia): boolean {
    const participant = this.participants.get(peerId);
    if (
      !participant ||
      (participant.audio === media.audio && participant.video === media.video)
    ) {
      return false;
    }
    this.participants.set(peerId, { ...participant, ...media });
    if (media.video && this.history) this.history.hadVideo = true;
    return true;
  }

  /**
   * Si le dernier participant vient de partir, clôt le direct et renvoie sa
   * trace (une seule fois) ; sinon `null`.
   */
  endIfEmpty(): CallSummary | null {
    if (!this.isEmpty() || !this.history) return null;

    const { startedAt, users, hadVideo } = this.history;
    this.history = null;
    const endedAt = new Date().toISOString();
    return {
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      participants: [...users.values()],
      hadVideo,
    };
  }
}

/**
 * Les directs en cours, un par conversation (salon, ami, groupe), en mémoire.
 * Le son et l'image ne passent jamais par le serveur (WebRTC).
 */
@Injectable()
export class CallService {
  private readonly rooms = new Map<string, CallRoom>();

  /** Le direct de la conversation `key` (vide s'il n'y en a pas). */
  room(key: string): CallRoom {
    let room = this.rooms.get(key);
    if (!room) {
      room = new CallRoom();
      this.rooms.set(key, room);
    }
    return room;
  }

  /** Oublie un direct terminé, pour ne rien garder inutilement en mémoire. */
  release(key: string) {
    if (this.rooms.get(key)?.isEmpty()) this.rooms.delete(key);
  }
}
