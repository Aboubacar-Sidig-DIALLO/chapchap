import type { ReactionEmoji } from '../chat/chat.constants';
import type { ChatUser } from '../chat/chat.types';

/** Ce qu'un participant partage : son micro (non coupé) et sa caméra. */
export interface CallMedia {
  audio: boolean;
  video: boolean;
}

/**
 * Participant au direct d'une conversation. `peerId` est l'identifiant de sa connexion
 * (un onglet), qui sert d'adresse pour la signalisation WebRTC.
 */
export interface CallParticipant extends CallMedia {
  peerId: string;
  user: ChatUser;
  /** Date ISO 8601 d'arrivée dans le direct. */
  joinedAt: string;
}

/** Trace d'un appel terminé, déposée dans la conversation. */
export interface CallSummary {
  /** Dates ISO 8601. */
  startedAt: string;
  endedAt: string;
  /**
   * Groupe : durée du direct. Entre amis : temps de conversation, compté
   * depuis la réponse (0 si personne n'a répondu).
   */
  durationMs: number;
  /** Tous ceux qui y sont passés, par ordre d'arrivée (le premier l'a lancé). */
  participants: ChatUser[];
  /** Au moins une caméra s'est allumée. */
  hadVideo: boolean;
  /** Entre amis : l'appel a été refusé par celui qu'on appelait. */
  declined: boolean;
}

/** Message WebRTC (offre, réponse, candidat ICE) relayé tel quel entre deux participants. */
export interface CallSignal {
  peerId: string;
  data: unknown;
}

export interface CallReaction {
  peerId: string;
  emoji: ReactionEmoji;
}

export type CallJoinAck =
  { ok: true; participants: CallParticipant[] } | { ok: false; error: string };

/** Événements de l'appel reçus par tous ses participants, membres comme invités. */
export interface CallServerEvents {
  'call:participants': (participants: CallParticipant[]) => void;
  'call:ended': () => void;
  'call:signal': (signal: CallSignal) => void;
  'call:reaction': (reaction: CallReaction) => void;
}

/** Espace `/call-guests` : un invité peut, en plus, être retiré de l'appel. */
export interface GuestServerEvents extends CallServerEvents {
  /** Un administrateur vous a retiré de l'appel : la connexion va se fermer. */
  'call:removed': () => void;
}
