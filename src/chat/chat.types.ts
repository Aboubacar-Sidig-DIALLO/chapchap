import type {
  Attachment,
  VoiceMetadata,
} from '../attachments/attachment.types';
import type {
  CallParticipant,
  CallReaction,
  CallSignal,
  CallSummary,
} from '../call/call.types';
import type { AuthSocketData } from '../auth/socket-auth';
import type { Conversation } from '../social/conversation-access.service';
import type {
  ConversationRights,
  PresenceChange,
} from '../social/social.types';
import type {
  TalkChunkEvent,
  TalkEndedEvent,
  TalkEvent,
} from '../talkie/talkie.types';
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
  /** Date ISO 8601 à laquelle le message disparaît, partout (une heure après l'envoi). */
  expiresAt: string;
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
  /**
   * Supprimé par un modérateur du groupe (propriétaire ou administrateur) :
   * contenu, pièces jointes et réactions effacés, seule reste la mention.
   */
  deletedBy?: ChatUser;
  /** Date ISO 8601 de la dernière modification par son auteur (texte corrigé, pièce jointe retirée). */
  editedAt?: string;
  /**
   * Vue unique : ses pièces jointes ne sont pas diffusées (`attachments` est
   * vide), seulement annoncées ; chaque destinataire les ouvre une fois.
   */
  viewOnce?: ViewOnce;
}

/** Genre d'une pièce jointe à vue unique, seule chose qu'on en sait avant de l'ouvrir. */
export type ViewOnceKind = 'voice' | 'image' | 'video' | 'file';

export interface ViewOnceItem {
  kind: ViewOnceKind;
  /** Durée d'un vocal. */
  durationMs?: number;
}

export interface ViewOnce {
  items: ViewOnceItem[];
  /** Destinataires qui l'ont ouvert (et ne peuvent plus le rouvrir). */
  openedBy: ChatUser[];
}

/** Une pièce jointe à vue unique, remise à celui qui l'ouvre, et à lui seul. */
export interface ViewOnceFile {
  kind: ViewOnceKind;
  name: string;
  mimeType: string;
  /** Chemin relatif à l'API, valable une minute : `/attachments/once/<ticket>`. */
  url: string;
  /** Durée et forme d'onde d'un vocal. */
  voice?: VoiceMetadata;
}

export type ViewOnceOpenAck =
  { ok: true; files: ViewOnceFile[] } | { ok: false; error: string };

export interface ViewOnceOpenedEvent {
  messageId: string;
  user: ChatUser;
}

export interface MessageDeletedEvent {
  messageId: string;
  deletedBy: ChatUser;
}

/** Réponse à une action sur un message (suppression, modification…). */
export type MessageActionAck = { ok: true } | { ok: false; error: string };

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
  /** Pièces jointes à vue unique (le message ne contient alors pas de texte). */
  viewOnce?: boolean;
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
/** Ce que le client sait de la conversation ouverte. */
export interface ConversationInfo {
  type: Conversation['type'];
  title: string;
  /** Photo du groupe (adresse relative à l'API) ; `null` sinon. */
  photoUrl: string | null;
  /** Ce que l'utilisateur peut y faire (écrire, parler, appeler, modérer). */
  rights: ConversationRights;
}

export interface ServerToClientEvents {
  /** Conversation ouverte (accès vérifié), juste avant son historique. */
  'conversation:ready': (conversation: ConversationInfo) => void;
  /** Le groupe a changé : nom, photo, ou vos droits. */
  'conversation:updated': (conversation: ConversationInfo) => void;
  /** Accès retiré (ami retiré, groupe quitté) : la connexion va être fermée. */
  'conversation:closed': () => void;
  /** Toutes les sessions de l'utilisateur ont été fermées : la connexion va se fermer. */
  'session:ended': () => void;
  'chat:history': (messages: ChatMessage[]) => void;
  'message:new': (message: ChatMessage) => void;
  /** Son auteur a modifié un message (texte corrigé, pièce jointe retirée) ; diffusé à tous. */
  'message:updated': (message: ChatMessage) => void;
  /** Son auteur a retiré un message que personne n'avait vu : il disparaît partout. */
  'message:unsent': (event: { messageId: string }) => void;
  /** Un modérateur a supprimé un message (diffusé à tous). */
  'message:deleted': (event: MessageDeletedEvent) => void;
  /** Groupe : qui a la conversation ouverte en ce moment. */
  'users:online': (users: ChatUser[]) => void;
  /**
   * Conversation privée : présence de l'ami dans l'application (en ligne, hors
   * ligne depuis…), à l'ouverture puis à chaque changement.
   */
  'friend:presence': (presence: PresenceChange) => void;
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
  /** Un destinataire a ouvert un message à vue unique (diffusé à tous). */
  'view-once:opened': (event: ViewOnceOpenedEvent) => void;
  /** Participants de l'appel, à la connexion puis à chaque changement (diffusé à tous). */
  'call:participants': (participants: CallParticipant[]) => void;
  /** Appel entre amis terminé par l'autre (raccroché, refusé, sans réponse) : on en sort. */
  'call:ended': () => void;
  /** Message WebRTC d'un autre participant (`peerId` : l'expéditeur). */
  'call:signal': (signal: CallSignal) => void;
  /** Réaction envoyée pendant le direct. */
  'call:reaction': (reaction: CallReaction) => void;
  /** Talkie-walkie : quelqu'un prend la parole en direct. */
  'talkie:started': (event: TalkEvent) => void;
  /** Un morceau de sa voix (PCM 16 bits, 16 kHz, mono). */
  'talkie:chunk': (event: TalkChunkEvent) => void;
  /** Il a relâché le micro ; diffusé à tous, orateur compris. */
  'talkie:ended': (event: TalkEndedEvent) => void;
}

/** Données d'une connexion de chat : l'utilisateur (session) et sa conversation (accès vérifié). */
export interface SocketData extends AuthSocketData {
  conversation: Conversation;
}
