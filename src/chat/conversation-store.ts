import { MESSAGE_TTL_MS, type ReactionEmoji } from './chat.constants';
import type { Attachment } from '../attachments/attachment.types';
import type {
  ChatMessage,
  ChatUser,
  Reaction,
  ReadReceipt,
} from './chat.types';

const HISTORY_LIMIT = 200;

/** Résultat d'un changement demandé par l'auteur : refusé, avec la raison. */
export type AuthorChange<T> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_FOUND = 'Ce message a déjà disparu';
const NOT_YOURS = 'Vous ne pouvez changer que vos propres messages';
const ALREADY_SEEN =
  'Ce message a déjà été vu : il ne peut plus être modifié ni supprimé';

export type NewMessage = Omit<
  ChatMessage,
  'seq' | 'expiresAt' | 'listenedBy' | 'listenProgress' | 'reactions'
>;

/**
 * Messages d'une conversation, en mémoire uniquement et pour une heure au
 * plus : rien n'est jamais écrit en base ni sur disque.
 */
export class ConversationStore {
  private messages: ChatMessage[] = [];
  private readonly receipts = new Map<string, ReadReceipt>();
  private lastSeq = 0;

  getHistory(): ChatMessage[] {
    return [...this.messages];
  }

  isEmpty(): boolean {
    return this.messages.length === 0;
  }

  /** Retire les messages expirés ; `true` si la conversation n'en contient plus aucun. */
  pruneExpired(now = Date.now()): boolean {
    this.messages = this.messages.filter(
      (message) => Date.parse(message.expiresAt) > now,
    );
    return this.isEmpty();
  }

  /**
   * Ajoute un message et lui attribue son numéro d'ordre et sa date
   * d'expiration. Idempotent : un message déjà reçu (même id, ex. renvoi après
   * un timeout) est retourné tel quel avec `isNew: false`.
   */
  addMessage(input: NewMessage): { message: ChatMessage; isNew: boolean } {
    const existing = this.messages.find((item) => item.id === input.id);
    if (existing) return { message: existing, isNew: false };

    const message: ChatMessage = {
      ...input,
      seq: ++this.lastSeq,
      expiresAt: new Date(
        Date.parse(input.createdAt) + MESSAGE_TTL_MS,
      ).toISOString(),
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
    if (!message || message.deletedBy) return null;

    const current = message.reactions.find((item) => item.user.id === user.id);
    if ((current?.emoji ?? null) === emoji) return null;

    const others = message.reactions.filter((item) => item.user.id !== user.id);
    message.reactions = emoji ? [...others, { user, emoji }] : others;
    return message.reactions;
  }

  /**
   * L'auteur corrige le texte de son message, tant que personne d'autre ne
   * l'a vu. Vider le texte n'est permis que s'il reste des pièces jointes.
   */
  editMessage(
    messageId: string,
    author: ChatUser,
    content: string,
  ): AuthorChange<{ message: ChatMessage; changed: boolean }> {
    const found = this.findChangeable(messageId, author);
    if (!found.ok) return found;
    const { message } = found;

    if (content === message.content)
      return { ok: true, message, changed: false };
    if (!content && message.attachments.length === 0) {
      return {
        ok: false,
        error: 'Un message ne peut pas être vide : supprimez-le plutôt',
      };
    }
    message.content = content;
    message.editedAt = new Date().toISOString();
    return { ok: true, message, changed: true };
  }

  /**
   * L'auteur retire son message, tant que personne d'autre ne l'a vu : il
   * disparaît sans laisser de trace. Renvoie ses pièces jointes, à effacer.
   */
  unsendMessage(
    messageId: string,
    author: ChatUser,
  ): AuthorChange<{ attachments: Attachment[] }> {
    const found = this.findChangeable(messageId, author);
    if (!found.ok) return found;

    this.messages = this.messages.filter((item) => item.id !== messageId);
    return { ok: true, attachments: found.message.attachments };
  }

  /**
   * L'auteur retire une pièce jointe (photo, fichier, vocal) de son message,
   * tant que personne d'autre ne l'a vu. S'il ne reste plus rien, le message
   * disparaît (`message: null`).
   */
  removeAttachment(
    messageId: string,
    attachmentId: string,
    author: ChatUser,
  ): AuthorChange<{ attachment: Attachment; message: ChatMessage | null }> {
    const found = this.findChangeable(messageId, author);
    if (!found.ok) return found;
    const { message } = found;

    const attachment = message.attachments.find(
      (item) => item.id === attachmentId,
    );
    if (!attachment) {
      return { ok: false, error: 'Cette pièce jointe a déjà disparu' };
    }
    message.attachments = message.attachments.filter(
      (item) => item.id !== attachmentId,
    );
    if (!message.content && message.attachments.length === 0) {
      this.messages = this.messages.filter((item) => item.id !== messageId);
      return { ok: true, attachment, message: null };
    }
    message.editedAt = new Date().toISOString();
    return { ok: true, attachment, message };
  }

  /**
   * Vu par quelqu'un d'autre que son auteur : lu à l'écran, ou vocal écouté
   * (même en partie). Il fait alors partie de la conversation pour de bon.
   */
  isSeenByOthers(message: ChatMessage): boolean {
    if (message.listenedBy.length > 0 || message.listenProgress.length > 0) {
      return true;
    }
    for (const receipt of this.receipts.values()) {
      if (
        receipt.user.id !== message.author.id &&
        receipt.readSeq >= message.seq
      ) {
        return true;
      }
    }
    return false;
  }

  /** Le message de `author` qu'il peut encore changer, ou pourquoi il ne le peut plus. */
  private findChangeable(
    messageId: string,
    author: ChatUser,
  ): AuthorChange<{ message: ChatMessage }> {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message || message.deletedBy || message.call) {
      return { ok: false, error: NOT_FOUND };
    }
    if (message.author.id !== author.id) return { ok: false, error: NOT_YOURS };
    if (this.isSeenByOthers(message)) return { ok: false, error: ALREADY_SEEN };
    return { ok: true, message };
  }

  /**
   * Supprime un message pour tout le monde (modération) : il ne garde que la
   * mention de qui l'a supprimé. Renvoie ses pièces jointes, à effacer du
   * disque ; `null` si le message n'existe pas, est déjà supprimé ou est
   * la trace d'un appel.
   */
  deleteMessage(messageId: string, by: ChatUser): Attachment[] | null {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message || message.deletedBy || message.call) return null;

    const { attachments } = message;
    Object.assign(message, {
      content: '',
      attachments: [],
      reactions: [],
      listenedBy: [],
      listenProgress: [],
      deletedBy: by,
    } satisfies Partial<ChatMessage>);
    return attachments;
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
}
