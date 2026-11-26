import { Injectable } from '@nestjs/common';
import type { ChatUser } from '../chat/chat.types';
import type { Conversation } from '../social/conversation-access.service';
import type { CallMedia, CallParticipant, CallSummary } from './call.types';

/** Au-delà, la connexion en maillage (chacun envoie à chacun) sature les réseaux mobiles. */
export const MAX_GROUP_CALL_PARTICIPANTS = 8;

/** Ce que l'on retient d'un appel en cours, pour sa trace. */
interface CallHistory {
  startedAt: string;
  /** Entre amis : quand l'appelé a répondu. */
  answeredAt: string | null;
  /** Par identifiant d'utilisateur, dans l'ordre d'arrivée. */
  users: Map<string, ChatUser>;
  hadVideo: boolean;
  declined: boolean;
}

/**
 * L'appel d'une conversation : qui y est, avec quel média, et son histoire.
 *
 * Entre amis, c'est un appel à deux : l'un appelle, l'autre répond ou refuse,
 * et il prend fin dès que l'un des deux raccroche. En groupe, c'est un direct
 * ouvert : chacun entre et sort quand il veut, le dernier à partir le clôt.
 */
export class CallRoom {
  private readonly participants = new Map<string, CallParticipant>();
  private history: CallHistory | null = null;

  constructor(readonly conversation: Conversation) {}

  get key(): string {
    return this.conversation.key;
  }

  /** Appel entre deux amis (sinon, direct de groupe). */
  get isDirect(): boolean {
    return this.conversation.type === 'direct';
  }

  list(): CallParticipant[] {
    return [...this.participants.values()];
  }

  has(peerId: string): boolean {
    return this.participants.has(peerId);
  }

  hasUser(userId: string): boolean {
    return this.list().some((participant) => participant.user.id === userId);
  }

  isFull(): boolean {
    const capacity = this.isDirect ? 2 : MAX_GROUP_CALL_PARTICIPANTS;
    return this.participants.size >= capacity;
  }

  isEmpty(): boolean {
    return this.participants.size === 0;
  }

  /** Entre amis : l'appelant attend encore la réponse de l'autre. */
  isRinging(): boolean {
    return (
      this.isDirect && this.participants.size === 1 && !this.history?.answeredAt
    );
  }

  /**
   * Date ISO 8601 du début de l'appel en cours (entre amis, de la réponse une
   * fois décroché) ; `null` s'il n'y en a pas.
   */
  startedAt(): string | null {
    if (!this.history) return null;
    return this.history.answeredAt ?? this.history.startedAt;
  }

  /** Ajoute le participant ; retourne ceux qui étaient déjà là (à qui il se connecte). */
  join(peerId: string, user: ChatUser, media: CallMedia): CallParticipant[] {
    const others = this.list().filter((item) => item.peerId !== peerId);
    const now = new Date().toISOString();

    this.history ??= {
      startedAt: now,
      answeredAt: null,
      users: new Map(),
      hadVideo: false,
      declined: false,
    };
    if (!this.history.users.has(user.id)) this.history.users.set(user.id, user);
    if (media.video) this.history.hadVideo = true;
    if (this.isDirect && others.length > 0) this.history.answeredAt ??= now;

    this.participants.set(peerId, {
      peerId,
      user,
      ...media,
      joinedAt: this.participants.get(peerId)?.joinedAt ?? now,
    });
    return others;
  }

  /** `true` si le participant était dans l'appel. */
  leave(peerId: string): boolean {
    return this.participants.delete(peerId);
  }

  /** Fin de l'appel pour tous : retire chacun et retourne ceux qui y étaient encore. */
  clear(): CallParticipant[] {
    const remaining = this.list();
    this.participants.clear();
    return remaining;
  }

  /** L'appelé a refusé (noté dans la trace). */
  markDeclined() {
    if (this.history) this.history.declined = true;
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
   * Si plus personne n'est dans l'appel, le clôt et renvoie sa trace (une
   * seule fois) ; sinon `null`.
   */
  endIfEmpty(): CallSummary | null {
    if (!this.isEmpty() || !this.history) return null;

    const { startedAt, answeredAt, users, hadVideo, declined } = this.history;
    this.history = null;
    const endedAt = new Date().toISOString();
    // Entre amis, seule compte la conversation : la sonnerie n'en fait pas partie.
    const from = this.isDirect ? answeredAt : startedAt;
    return {
      startedAt,
      endedAt,
      durationMs: from ? Date.parse(endedAt) - Date.parse(from) : 0,
      participants: [...users.values()],
      hadVideo,
      declined,
    };
  }
}

/**
 * Les appels en cours, un par conversation (ami ou groupe), en mémoire.
 * Le son et l'image ne passent jamais par le serveur (WebRTC).
 */
@Injectable()
export class CallService {
  private readonly rooms = new Map<string, CallRoom>();

  /** L'appel de la conversation (vide s'il n'y en a pas). */
  room(conversation: Conversation): CallRoom {
    let room = this.rooms.get(conversation.key);
    if (!room) {
      room = new CallRoom(conversation);
      this.rooms.set(conversation.key, room);
    }
    return room;
  }

  /** L'appel en cours dans la conversation `key`, s'il y en a un. */
  find(key: string): CallRoom | null {
    const room = this.rooms.get(key);
    return room && !room.isEmpty() ? room : null;
  }

  /** Oublie un appel terminé, pour ne rien garder inutilement en mémoire. */
  release(key: string) {
    if (this.rooms.get(key)?.isEmpty()) this.rooms.delete(key);
  }
}
