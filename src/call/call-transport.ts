import { Injectable } from '@nestjs/common';
import type { Namespace, Server } from 'socket.io';
import type { ChatMessage } from '../chat/chat.types';
import type {
  CallParticipant,
  CallReaction,
  CallServerEvents,
  CallSignal,
  GuestServerEvents,
} from './call.types';

type MembersServer = Server<
  Record<string, never>,
  CallServerEvents & { 'message:new': (message: ChatMessage) => void }
>;
type GuestsNamespace = Namespace<Record<string, never>, GuestServerEvents>;

/**
 * Acheminement des événements d'appel vers ses participants, où qu'ils soient
 * connectés : les membres sur l'espace principal (celui du chat), les invités
 * sur l'espace `/call-guests`, isolé de tout le reste. Un participant est
 * désigné par l'identifiant de sa connexion (`peerId`) ; un envoi vers une
 * connexion d'un autre espace est simplement sans effet.
 */
@Injectable()
export class CallTransport {
  private members?: MembersServer;
  private guests?: GuestsNamespace;

  attachMembers(server: MembersServer) {
    this.members = server;
  }

  attachGuests(namespace: GuestsNamespace) {
    this.guests = namespace;
  }

  /** Participants à jour, pour tous ceux qui suivent l'appel de la conversation `key`. */
  participants(key: string, participants: CallParticipant[]) {
    this.members?.to(key).emit('call:participants', participants);
    this.guests?.to(key).emit('call:participants', participants);
  }

  signal(peerId: string, signal: CallSignal) {
    this.members?.to(peerId).emit('call:signal', signal);
    this.guests?.to(peerId).emit('call:signal', signal);
  }

  reaction(peerIds: string[], reaction: CallReaction) {
    if (peerIds.length === 0) return;
    this.members?.to(peerIds).emit('call:reaction', reaction);
    this.guests?.to(peerIds).emit('call:reaction', reaction);
  }

  /** L'appel est fini pour eux. */
  ended(peerIds: string[]) {
    if (peerIds.length === 0) return;
    this.members?.to(peerIds).emit('call:ended');
    this.guests?.to(peerIds).emit('call:ended');
  }

  /** Message déposé dans la conversation (trace de l'appel) : pour ses membres seulement. */
  newMessage(key: string, message: ChatMessage) {
    this.members?.to(key).emit('message:new', message);
  }

  /** Ferme les connexions des invités de l'appel `key` (appel terminé). */
  dismissGuests(key: string) {
    this.guests?.in(key).disconnectSockets(true);
  }

  /** Retire un invité : il en est prévenu, puis sa connexion se ferme. */
  removeGuest(peerId: string) {
    const socket = this.guests?.sockets.get(peerId);
    socket?.emit('call:removed');
    socket?.disconnect(true);
  }
}
