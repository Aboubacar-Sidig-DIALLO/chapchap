/** Contrat de l'API sociale — à garder synchronisé avec le front (`chat-nextjs/src/features/social/types.ts`). */

/**
 * Ce qu'on montre d'un autre utilisateur. Jamais son email : il suffit
 * à se connecter à son compte.
 */
export interface PublicUser {
  id: string;
  name: string;
  image: string | null;
}

/** Lien entre l'utilisateur connecté et quelqu'un d'autre. */
export type Relation =
  | 'none'
  /** Amis. */
  | 'friend'
  /** Il m'a envoyé une demande. */
  | 'incoming'
  /** Je lui ai envoyé une demande. */
  | 'outgoing';

export interface SearchResult extends PublicUser {
  relation: Relation;
}

/** Présence d'un ami : en ligne, ou depuis quand il ne l'est plus. */
export interface Presence {
  online: boolean;
  /** Date ISO 8601 de son dernier départ ; `null` s'il est en ligne ou ne s'est jamais déconnecté. */
  lastSeenAt: string | null;
}

/** Appel en cours dans une conversation privée ou de groupe. */
export interface OngoingCall {
  /** Date ISO 8601 du début de l'appel. */
  startedAt: string;
  /** Qui y est en ce moment, par ordre d'arrivée (chacun une seule fois). */
  participants: PublicUser[];
}

/** Un ami, avec sa présence (visible de ses seuls amis). */
export interface Friend extends PublicUser {
  presence: Presence;
  /** Appel en cours dans votre conversation avec lui. */
  call: OngoingCall | null;
}

/** Un utilisateur arrive ou quitte l'application. */
export interface PresenceChange extends Presence {
  userId: string;
}

export interface FriendsOverview {
  friends: Friend[];
  /** Demandes reçues, en attente de ma réponse. */
  incoming: PublicUser[];
  /** Demandes envoyées, en attente de leur réponse. */
  outgoing: PublicUser[];
}

export interface GroupSummary {
  id: string;
  name: string;
  /** Date ISO 8601. */
  createdAt: string;
  members: PublicUser[];
  /** Appel en cours dans le groupe, visible sans y entrer. */
  call: OngoingCall | null;
}

/** Résultat d'une action sur un lien d'amitié. */
export interface FriendshipChange {
  relation: Relation;
  /** `false` si rien n'a changé (demande déjà envoyée, lien déjà supprimé…). */
  changed: boolean;
}

/** Événement à signaler à l'utilisateur concerné, en plus de la mise à jour de ses listes. */
export type SocialNotice =
  | { type: 'friend-request'; user: PublicUser }
  | { type: 'friend-accepted'; user: PublicUser }
  | { type: 'group-added'; user: PublicUser; groupName: string };

/** Événements Socket.io de l'espace `/social` (serveur → client). */
export interface SocialServerEvents {
  /**
   * Les amis, demandes ou groupes de l'utilisateur ont changé : le client
   * recharge ses listes. `notice` accompagne ce qui mérite d'être annoncé.
   */
  'social:changed': (event: { notice: SocialNotice | null }) => void;
  /** Nouveau message dans une conversation privée ou de groupe (jamais son contenu). */
  'social:message': (event: MessageNotice) => void;
  /** Un ami arrive ou quitte l'application. */
  'presence:changed': (event: PresenceChange) => void;
  /** Un appel commence : à faire sonner chez les autres membres. */
  'call:started': (event: CallInvite) => void;
  /** Un appel a commencé, changé de participants ou pris fin (`call: null`). */
  'call:changed': (event: CallChange) => void;
}

/** Invitation à rejoindre un appel qui vient de commencer. */
export interface CallInvite {
  conversation: ConversationTarget;
  startedBy: PublicUser;
}

export interface CallChange {
  conversation: ConversationTarget;
  call: OngoingCall | null;
}

/** Conversation vue depuis le destinataire : l'ami qui écrit, ou le groupe. */
export type ConversationTarget =
  | { type: 'direct'; userId: string }
  | { type: 'group'; groupId: string; groupName: string };

/** Annonce d'un nouveau message, sans son contenu : de quoi signaler « Léa vous a écrit ». */
export interface MessageNotice {
  conversation: ConversationTarget;
  from: PublicUser;
}
