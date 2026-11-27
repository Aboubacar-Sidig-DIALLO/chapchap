import type { OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ChatService } from '../chat/chat.service';
import type { ServerToClientEvents, SocketData } from '../chat/chat.types';
import { CLIENT_ORIGIN } from '../config';
import {
  ConversationAccessService,
  rightsIn,
} from '../social/conversation-access.service';
import { restrictionError } from '../social/group-rights';
import { MAX_CHUNK_BYTES, TALK_IDLE_TIMEOUT_MS } from './talkie.constants';
import { TalkieService, type Talk } from './talkie.service';
import type { TalkStartAck } from './talkie.types';

type TalkieServer = Server<
  Record<string, never>,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type TalkieSocket = Socket<
  Record<string, never>,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/** Même forme que les ids de message générés par le client. */
const TALK_ID = /^[\w-]{1,64}$/;

function isAudioChunk(value: unknown): value is Buffer {
  return (
    Buffer.isBuffer(value) &&
    value.length > 0 &&
    value.length <= MAX_CHUNK_BYTES &&
    // Échantillons de 16 bits : jamais un octet orphelin.
    value.length % 2 === 0
  );
}

/**
 * Talkie-walkie : tant que l'orateur maintient le micro, sa voix est relayée
 * en direct à ceux qui ont la conversation ouverte. Le serveur ne garde
 * rien : il vérifie le droit de parler, tient le canal (une voix à la fois)
 * et relaie le son, sans jamais sortir de la conversation.
 *
 * Le même enregistrement part ensuite comme vocal classique (même id) :
 * les absents le reçoivent, et ceux qui l'ont entendu en direct le voient
 * déjà « écouté ».
 */
@WebSocketGateway({ cors: { origin: CLIENT_ORIGIN, credentials: true } })
export class TalkieGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  // `!` : assigné par Nest après la construction (`@WebSocketServer`).
  @WebSocketServer()
  private readonly server!: TalkieServer;
  /** Filet de sécurité : une prise de parole muette (client figé) libère le canal. */
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly talkieService: TalkieService,
    private readonly chatService: ChatService,
    private readonly conversationAccess: ConversationAccessService,
  ) {}

  onModuleDestroy() {
    this.idleTimers.forEach((timer) => clearTimeout(timer));
  }

  /** Arrivé pendant que quelqu'un parle : on entend la suite. */
  handleConnection(client: TalkieSocket) {
    const talk = this.talkieService.current(client.data.conversation.key);
    if (talk) client.emit('talkie:started', { id: talk.id, user: talk.user });
  }

  handleDisconnect(client: TalkieSocket) {
    if (client.data.conversation) this.finish(client, false);
  }

  /** Demande la parole ; refusée, le client enregistre un vocal classique. */
  @SubscribeMessage('talkie:start')
  async handleStart(
    @ConnectedSocket() client: TalkieSocket,
    @MessageBody() payload: unknown,
  ): Promise<TalkStartAck> {
    const { id } = (payload ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || !TALK_ID.test(id)) {
      return {
        ok: false,
        reason: 'invalid',
        error: 'Prise de parole invalide',
      };
    }

    // Les droits ont pu changer depuis la connexion : ils sont relus en base.
    const { user, conversation } = client.data;
    const rights = await this.conversationAccess.rights(user.id, conversation);
    const forbidden = rights
      ? restrictionError(rights, ['voice'])
      : "Vous n'avez plus accès à cette conversation";
    if (forbidden) return { ok: false, reason: 'forbidden', error: forbidden };

    const listeners = this.chatService
      .getOnlineUsers(conversation.key)
      .filter((listener) => listener.id !== user.id);
    if (listeners.length === 0) return { ok: false, reason: 'alone' };

    const claim = this.talkieService.claim(
      conversation.key,
      client.id,
      user,
      id,
    );
    if (!claim.ok) return { ok: false, reason: 'busy', speaker: claim.speaker };

    this.armIdleTimer(client);
    client.to(conversation.key).emit('talkie:started', { id, user });
    return { ok: true, listeners };
  }

  /** Un morceau de voix de l'orateur, relayé aux autres connexions de la conversation. */
  @SubscribeMessage('talkie:chunk')
  handleChunk(
    @ConnectedSocket() client: TalkieSocket,
    @MessageBody() audio: unknown,
  ) {
    const { user, conversation } = client.data;
    if (!isAudioChunk(audio)) return;

    // Restreint en pleine prise de parole (droits mis à jour en mémoire) : on coupe.
    if (rightsIn(conversation, user.id)?.restrictions.voice) {
      this.finish(client, false);
      return;
    }

    const verdict = this.talkieService.accept(
      conversation.key,
      client.id,
      audio.length,
    );
    if (verdict === 'over') {
      this.finish(client, false);
      return;
    }
    if (verdict === 'ignored') return;

    const talk = this.talkieService.current(conversation.key);
    if (!talk) return;
    this.armIdleTimer(client);
    client.to(conversation.key).emit('talkie:chunk', { id: talk.id, audio });
  }

  /** L'orateur a relâché (`cancelled` : il a annulé son vocal). */
  @SubscribeMessage('talkie:end')
  handleEnd(
    @ConnectedSocket() client: TalkieSocket,
    @MessageBody() payload: unknown,
  ) {
    const { cancelled } = (payload ?? {}) as Record<string, unknown>;
    this.finish(client, cancelled === true);
  }

  /** Rend la parole et prévient toute la conversation, orateur compris. */
  private finish(client: TalkieSocket, cancelled: boolean) {
    const key = client.data.conversation.key;
    const talk = this.talkieService.release(key, client.id);
    if (!talk) return;

    this.clearIdleTimer(key);
    this.announceEnd(key, talk, cancelled);
  }

  private announceEnd(key: string, talk: Talk, cancelled: boolean) {
    this.server
      .to(key)
      .emit('talkie:ended', { id: talk.id, user: talk.user, cancelled });
  }

  private armIdleTimer(client: TalkieSocket) {
    const key = client.data.conversation.key;
    this.clearIdleTimer(key);

    const timer = setTimeout(() => {
      this.idleTimers.delete(key);
      this.finish(client, false);
    }, TALK_IDLE_TIMEOUT_MS);
    timer.unref();
    this.idleTimers.set(key, timer);
  }

  private clearIdleTimer(key: string) {
    clearTimeout(this.idleTimers.get(key));
    this.idleTimers.delete(key);
  }
}
