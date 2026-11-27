import { MESSAGE_TTL_MS, type ReactionEmoji } from './chat.constants';
import type { Attachment } from '../attachments/attachment.types';
import type {
  ChatMessage,
  ChatUser,
  Reaction,
  ReadReceipt,
} from './chat.types';
import { isMomentOf, voiceDurationOf } from './replies';
import { toViewOnceItem } from './view-once';

const HISTORY_LIMIT = 200;

/** Résultat d'un changement demandé par l'auteur : refusé, avec la raison. */
export type AuthorChange<T> = ({ ok: true } & T) | { ok: false; error: string };

const NOT_FOUND = 'Ce message a déjà disparu';
const NOT_YOURS = 'Vous ne pouvez changer que vos propres messages';
const ALREADY_SEEN =
  'Ce message a déjà été vu : il ne peut plus être modifié ni supprimé';

export type NewMessage = Omit<
  ChatMessage,
  | 'seq'
  | 'expiresAt'
  | 'listenedBy'
  | 'listenProgress'
  | 'reactions'
  | 'viewOnce'
>;

/** Ce que le serveur garde pour lui d'un message à vue unique. */
interface ViewOnceSecret {
  /** Les vraies pièces jointes, jamais diffusées. */
  attachments: Attachment[];
  /** Ceux qui peuvent l'ouvrir (une fois) : les membres, sauf son auteur, à l'envoi. */
  recipientIds: ReadonlySet<string>;
}

/** Résultat de l'ouverture d'un message à vue unique. */
export type ViewOnceOpening =
  | {
      ok: true;
      attachments: Attachment[];
      /** Tous les destinataires l'ont ouvert : ses fichiers n'ont plus de raison d'être. */
      isExhausted: boolean;
    }
  | { ok: false; error: string };

/**
 * Messages d'une conversation, en mémoire uniquement et pour une heure au
 * plus : rien n'est jamais écrit en base ni sur disque.
 */
export class ConversationStore {
  private messages: ChatMessage[] = [];
  /** Pièces jointes des messages à vue unique, par id de message. */
  private readonly viewOnceSecrets = new Map<string, ViewOnceSecret>();
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
    this.messages = this.messages.filter((message) => {
      const isAlive = Date.parse(message.expiresAt) > now;
      if (!isAlive) this.viewOnceSecrets.delete(message.id);
      return isAlive;
    });
    return this.isEmpty();
  }

  find(messageId: string): ChatMessage | undefined {
    return this.messages.find((item) => item.id === messageId);
  }

  /**
   * Ajoute un message et lui attribue son numéro d'ordre et sa date
   * d'expiration. Idempotent : un message déjà reçu (même id, ex. renvoi après
   * un timeout) est retourné tel quel avec `isNew: false`.
   *
   * `viewOnceFor` : message à vue unique, que ces destinataires ouvriront
   * une fois chacun. Ses pièces jointes restent alors ici, seule leur
   * annonce est diffusée.
   */
  addMessage(
    input: NewMessage,
    { viewOnceFor }: { viewOnceFor?: readonly string[] } = {},
  ): { message: ChatMessage; isNew: boolean } {
    const existing = this.find(input.id);
    if (existing) return { message: existing, isNew: false };

    const message: ChatMessage = {
      ...input,
      ...(viewOnceFor && {
        attachments: [],
        viewOnce: {
          items: input.attachments.map(toViewOnceItem),
          openedBy: [],
        },
      }),
      seq: ++this.lastSeq,
      expiresAt: new Date(
        Date.parse(input.createdAt) + MESSAGE_TTL_MS,
      ).toISOString(),
      listenedBy: [],
      listenProgress: [],
      reactions: [],
    };
    this.messages.push(message);
    if (viewOnceFor) {
      this.viewOnceSecrets.set(message.id, {
        attachments: input.attachments,
        recipientIds: new Set(viewOnceFor),
      });
    }
    if (this.messages.length > HISTORY_LIMIT) {
      const oldest = this.messages.shift();
      if (oldest) this.viewOnceSecrets.delete(oldest.id);
    }

    return { message, isNew: true };
  }

  /**
   * Un destinataire ouvre un message à vue unique : il reçoit ses pièces
   * jointes, et c'est la seule fois. Quand tous l'ont ouvert, le serveur
   * l'oublie (`isExhausted`) : ses fichiers peuvent disparaître.
   */
  openViewOnce(messageId: string, user: ChatUser): ViewOnceOpening {
    const message = this.find(messageId);
    const secret = this.viewOnceSecrets.get(messageId);
    if (!message?.viewOnce || message.deletedBy || !secret) {
      return { ok: false, error: 'Ce contenu a déjà disparu' };
    }
    if (message.author.id === user.id) {
      return { ok: false, error: 'Seuls ses destinataires peuvent l’ouvrir' };
    }
    if (!secret.recipientIds.has(user.id)) {
      return {
        ok: false,
        error: 'Envoyé avant votre arrivée : il ne vous est pas destiné',
      };
    }
    const { openedBy } = message.viewOnce;
    if (openedBy.some((item) => item.id === user.id)) {
      return { ok: false, error: 'Déjà ouvert : il ne s’ouvre qu’une fois' };
    }

    openedBy.push(user);
    const isExhausted = [...secret.recipientIds].every((id) =>
      openedBy.some((item) => item.id === id),
    );
    if (isExhausted) this.viewOnceSecrets.delete(messageId);
    return { ok: true, attachments: secret.attachments, isExhausted };
  }

  /** Ses pièces jointes, y compris celles, gardées ici, d'une vue unique. */
  private attachmentsOf(message: ChatMessage): Attachment[] {
    return (
      this.viewOnceSecrets.get(message.id)?.attachments ?? message.attachments
    );
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
   * Pose, remplace ou retire (`null`) la réaction de `user` sur un message ;
   * `atMs` la pose sur un moment précis de son vocal (« 🔥 à 0:42 »).
   * Retourne les réactions à jour, ou `null` si rien n'a changé (ou si le
   * moment n'existe pas dans le vocal).
   */
  setReaction(
    messageId: string,
    user: ChatUser,
    emoji: ReactionEmoji | null,
    atMs?: number,
  ): Reaction[] | null {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message || message.deletedBy) return null;
    if (emoji && atMs !== undefined && !isMomentOf(message, atMs)) return null;

    const current = message.reactions.find((item) => item.user.id === user.id);
    const isUnchanged = emoji
      ? current?.emoji === emoji && current.atMs === atMs
      : !current;
    if (isUnchanged) return null;

    const others = message.reactions.filter((item) => item.user.id !== user.id);
    message.reactions = emoji
      ? [...others, { user, emoji, ...(atMs !== undefined && { atMs }) }]
      : others;
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

    if (message.viewOnce) {
      return { ok: false, error: 'Un message à vue unique ne se modifie pas' };
    }
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

    const attachments = this.attachmentsOf(found.message);
    this.messages = this.messages.filter((item) => item.id !== messageId);
    this.viewOnceSecrets.delete(messageId);
    return { ok: true, attachments };
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
    // Plus de vocal : les réactions posées sur l'un de ses moments valent pour tout le message.
    if (voiceDurationOf(message) === null) {
      message.reactions = message.reactions.map(({ user, emoji }) => ({
        user,
        emoji,
      }));
    }
    message.editedAt = new Date().toISOString();
    return { ok: true, attachment, message };
  }

  /**
   * Vu par quelqu'un d'autre que son auteur : lu à l'écran, ou vocal écouté
   * (même en partie). Il fait alors partie de la conversation pour de bon.
   */
  isSeenByOthers(message: ChatMessage): boolean {
    if (
      message.listenedBy.length > 0 ||
      message.listenProgress.length > 0 ||
      (message.viewOnce?.openedBy.length ?? 0) > 0
    ) {
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
   * mention de qui l'a supprimé. Renvoie son auteur et ses pièces jointes (à
   * effacer du disque) ; `null` si le message n'existe pas, est déjà supprimé
   * ou est la trace d'un appel.
   */
  deleteMessage(
    messageId: string,
    by: ChatUser,
  ): { author: ChatUser; attachments: Attachment[] } | null {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message || message.deletedBy || message.call) return null;

    const { author } = message;
    const attachments = this.attachmentsOf(message);
    this.viewOnceSecrets.delete(messageId);
    Object.assign(message, {
      content: '',
      attachments: [],
      reactions: [],
      listenedBy: [],
      listenProgress: [],
      viewOnce: undefined,
      deletedBy: by,
    } satisfies Partial<ChatMessage>);
    return { author, attachments };
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
