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

/** Trace d'un direct terminé, déposée dans la conversation. */
export interface CallSummary {
  /** Dates ISO 8601. */
  startedAt: string;
  endedAt: string;
  durationMs: number;
  /** Tous ceux qui y sont passés, par ordre d'arrivée (le premier l'a lancé). */
  participants: ChatUser[];
  /** Au moins une caméra s'est allumée. */
  hadVideo: boolean;
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
