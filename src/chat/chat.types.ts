import type { Attachment } from '../attachments/attachment.types';
import type {
  CallParticipant,
  CallReaction,
  CallSignal,
  CallSummary,
} from '../call/call.types';
import type { ReactionEmoji } from './chat.constants';

export interface ChatUser {
  id: string;
  name: string;
}

export interface ChatMessage {
  id: string;
  /** Numéro d'ordre attribué par le serveur (1, 2, 3…), base des accusés de lecture. */
  seq: number;
  author: ChatUser;
  /** Peut être vide si le message ne contient que des pièces jointes. */
  content: string;
  attachments: Attachment[];
  /** Date ISO 8601, fixée par le serveur. */
  createdAt: string;
  /** Participants ayant écouté le message vocal (hors auteur). */
  listenedBy: ChatUser[];
  /** Jusqu'où chaque participant a écouté le vocal, même partiellement. */
  listenProgress: ListenProgress[];
  /** Une réaction au plus par participant. */
  reactions: Reaction[];
  /**
   * Trace d'un direct terminé : message déposé par le serveur (jamais par un
   * client), au nom de celui qui l'avait lancé.
   */
  call?: CallSummary;
}

export interface Reaction {
  user: ChatUser;
  emoji: ReactionEmoji;
}

export interface ReactionsEvent {
  messageId: string;
  reactions: Reaction[];
}

/** Part d'un vocal déjà entendue par un participant (ne recule jamais). */
export interface ListenProgress {
  user: ChatUser;
  /** Entier de 0 à 100. */
  percent: number;
}

/** Ce qu'un participant est en train de faire. */
export type UserActivity = 'typing' | 'recording';

export interface SendMessagePayload {
  id: string;
  content: string;
  /** Ids obtenus via `POST /attachments`. */
  attachmentIds?: string[];
}

export type SendMessageAck =
  { ok: true; message: ChatMessage } | { ok: false; error: string };

/**
 * Accusé de réception / lecture d'un utilisateur, sous forme de « curseurs » :
 * tous les messages dont le `seq` est ≤ `deliveredSeq` ont été reçus par son
 * navigateur, et ceux ≤ `readSeq` ont été affichés à l'écran.
 * Un seul objet par utilisateur, quel que soit le nombre de messages.
 */
export interface ReadReceipt {
  user: ChatUser;
  deliveredSeq: number;
  readSeq: number;
}

/** `activity: null` : le participant ne fait plus rien. */
export interface ActivityEvent {
  user: ChatUser;
  activity: UserActivity | null;
}

export interface ListenedEvent {
  messageId: string;
  user: ChatUser;
}

export interface ProgressEvent extends ListenProgress {
  messageId: string;
}

/** `messageId: null` : le participant n'écoute plus rien. */
export interface ListeningEvent {
  messageId: string | null;
  user: ChatUser;
}

/** Contrat Socket.io — à garder synchronisé avec le client (`lib/socket.ts`). */
export interface ServerToClientEvents {
  'chat:history': (messages: ChatMessage[]) => void;
  'message:new': (message: ChatMessage) => void;
  'users:online': (users: ChatUser[]) => void;
  /** Tous les accusés à la connexion, puis uniquement ceux qui changent. */
  'receipts:update': (receipts: ReadReceipt[]) => void;
  /** Un participant écrit, enregistre un vocal, ou s'arrête. */
  activity: (event: ActivityEvent) => void;
  /** Un participant a écouté un message vocal (diffusé à tous). */
  'voice:listened': (event: ListenedEvent) => void;
  /** Un participant écoute un vocal en ce moment, ou s'arrête (état éphémère). */
  'voice:listening': (event: ListeningEvent) => void;
  /** Un participant a avancé dans l'écoute d'un vocal (diffusé à tous). */
  'voice:progress': (event: ProgressEvent) => void;
  /** Les réactions d'un message ont changé (diffusé à tous). */
  'message:reactions': (event: ReactionsEvent) => void;
  /** Participants du direct, à la connexion puis à chaque changement (diffusé à tous). */
  'call:participants': (participants: CallParticipant[]) => void;
  /** Message WebRTC d'un autre participant (`peerId` : l'expéditeur). */
  'call:signal': (signal: CallSignal) => void;
  /** Réaction envoyée pendant le direct. */
  'call:reaction': (reaction: CallReaction) => void;
}

export interface SocketData {
  user: ChatUser;
}
