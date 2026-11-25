import { Injectable } from '@nestjs/common';
import type { ReactionEmoji } from './chat.constants';
import type {
  ChatMessage,
  ChatUser,
  Reaction,
  ReadReceipt,
} from './chat.types';

const HISTORY_LIMIT = 200;

/** Stockage en mémoire : l'historique est perdu au redémarrage du serveur. */
@Injectable()
export class ChatService {
  private readonly messages: ChatMessage[] = [];
  private readonly connections = new Map<string, ChatUser>();
  private readonly receipts = new Map<string, ReadReceipt>();
  private lastSeq = 0;

  getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * Ajoute un message et lui attribue son numéro d'ordre. Idempotent : un
   * message déjà reçu (même id, ex. renvoi après un timeout) est retourné tel
   * quel avec `isNew: false`.
   */
  addMessage(
    input: Omit<
      ChatMessage,
      'seq' | 'listenedBy' | 'listenProgress' | 'reactions'
    >,
  ): {
    message: ChatMessage;
    isNew: boolean;
  } {
    const existing = this.messages.find((item) => item.id === input.id);
    if (existing) return { message: existing, isNew: false };

    const message: ChatMessage = {
      ...input,
      seq: ++this.lastSeq,
      listenedBy: [],
      listenProgress: [],
      reactions: [],
    };
    this.messages.push(message);
    if (this.messages.length > HISTORY_LIMIT) this.messages.shift();

    return { message, isNew: true };
  }

  /**
   * Note qu'un participant a écouté un message vocal. Sans effet (`false`) si
   * le message n'est pas un vocal, si c'est son auteur, ou si c'est déjà noté.
   */
  markListened(messageId: string, user: ChatUser): boolean {
    const message = this.findVoiceOfOthers(messageId, user);
    if (
      !message ||
      message.listenedBy.some((listener) => listener.id === user.id)
    ) {
      return false;
    }

    message.listenedBy.push(user);
    return true;
  }

  /**
   * Note jusqu'où un participant a écouté un vocal (`percent`, entier de 0 à 100).
   * La progression ne recule jamais : retourne `true` seulement si elle avance.
   */
  updateListenProgress(
    messageId: string,
    user: ChatUser,
    percent: number,
  ): boolean {
    const message = this.findVoiceOfOthers(messageId, user);
    if (!message) return false;

    const entry = message.listenProgress.find(
      (item) => item.user.id === user.id,
    );
    if (percent <= (entry?.percent ?? 0)) return false;

    if (entry) entry.percent = percent;
    else message.listenProgress.push({ user, percent });
    return true;
  }

  /**
   * Pose, remplace ou retire (`null`) la réaction de `user` sur un message.
   * Retourne les réactions à jour, ou `null` si rien n'a changé.
   */
  setReaction(
    messageId: string,
    user: ChatUser,
    emoji: ReactionEmoji | null,
  ): Reaction[] | null {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message) return null;

    const current = message.reactions.find((item) => item.user.id === user.id);
    if ((current?.emoji ?? null) === emoji) return null;

    const others = message.reactions.filter((item) => item.user.id !== user.id);
    message.reactions = emoji ? [...others, { user, emoji }] : others;
    return message.reactions;
  }

  /** Vrai si `user` peut signaler l'écoute en cours de ce message (un vocal d'un autre). */
  canListen(messageId: string, user: ChatUser): boolean {
    return this.findVoiceOfOthers(messageId, user) !== undefined;
  }

  private findVoiceOfOthers(messageId: string, user: ChatUser) {
    const message = this.messages.find((item) => item.id === messageId);
    const isVoice = message?.attachments.some((attachment) => attachment.voice);
    return isVoice && message?.author.id !== user.id ? message : undefined;
  }

  getReceipts(): ReadReceipt[] {
    return [...this.receipts.values()];
  }

  /**
   * Fait avancer les curseurs de réception / lecture d'un utilisateur. Ils ne
   * reculent jamais, ne dépassent pas le dernier message, et un message lu est
   * forcément reçu. Retourne l'accusé mis à jour, ou `null` s'il n'a pas changé
   * (rien à diffuser).
   */
  updateReceipt(
    user: ChatUser,
    { deliveredSeq = 0, readSeq = 0 }: Partial<Omit<ReadReceipt, 'user'>>,
  ): ReadReceipt | null {
    const current = this.receipts.get(user.id) ?? {
      user,
      deliveredSeq: 0,
      readSeq: 0,
    };

    const nextReadSeq = Math.min(
      Math.max(current.readSeq, readSeq),
      this.lastSeq,
    );
    const nextDeliveredSeq = Math.min(
      Math.max(current.deliveredSeq, deliveredSeq, nextReadSeq),
      this.lastSeq,
    );

    if (
      nextReadSeq === current.readSeq &&
      nextDeliveredSeq === current.deliveredSeq
    ) {
      return null;
    }

    const receipt: ReadReceipt = {
      user,
      deliveredSeq: nextDeliveredSeq,
      readSeq: nextReadSeq,
    };
    this.receipts.set(user.id, receipt);
    return receipt;
  }

  addConnection(socketId: string, user: ChatUser) {
    this.connections.set(socketId, user);
  }

  removeConnection(socketId: string) {
    this.connections.delete(socketId);
  }

  /** Utilisateurs connectés, dédoublonnés (un même utilisateur peut ouvrir plusieurs onglets). */
  getOnlineUsers(): ChatUser[] {
    const users = new Map<string, ChatUser>();
    for (const user of this.connections.values()) users.set(user.id, user);
    return [...users.values()];
  }
}
