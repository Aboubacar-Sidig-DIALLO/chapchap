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
import { userRoom } from '../social/social.utils';
import { QuietModeService } from '../quiet-mode/quiet-mode.service';
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
 *
 * Heures calmes : ceux qui ne veulent pas être dérangés n'entendent rien en
 * direct. Le talkie bascule pour eux en vocal différé : ils reçoivent le
 * vocal, sans bruit, à écouter quand ils voudront.
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
    private readonly quietMode: QuietModeService,
  ) {}

  onModuleDestroy() {
    this.idleTimers.forEach((timer) => clearTimeout(timer));
  }

  /**
   * Arrivé pendant que quelqu'un parle : on entend la suite — sauf en heures
   * calmes, où l'on attendra le vocal.
   */
  async handleConnection(client: TalkieSocket) {
    const { user, conversation } = client.data;
    const talk = this.talkieService.current(conversation.key);
    if (!talk) return;

    if (
      talk.quietUserIds.includes(user.id) ||
      (await this.quietMode.isQuiet(user.id))
    ) {
      if (!talk.quietUserIds.includes(user.id)) talk.quietUserIds.push(user.id);
      return;
    }
    // Toujours la même prise de parole (l'attente a pu durer) : on l'annonce.
    if (this.talkieService.current(conversation.key) === talk) {
      client.emit('talkie:started', { id: talk.id, user: talk.user });
    }
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

    const present = this.chatService
      .getOnlineUsers(conversation.key)
      .filter((listener) => listener.id !== user.id);
    if (present.length === 0) return { ok: false, reason: 'alone' };

    // Heures calmes : ceux-là recevront le vocal, sans l'entendre en direct.
    const quietIds = new Set(
      await this.quietMode.quietUserIds(present.map((listener) => listener.id)),
    );
    const listeners = present.filter((listener) => !quietIds.has(listener.id));
    const deferred = present.filter((listener) => quietIds.has(listener.id));
    if (listeners.length === 0) {
      return { ok: false, reason: 'quiet', users: deferred };
    }

    const claim = this.talkieService.claim(
      conversation.key,
      client.id,
      user,
      id,
      {
        quietUserIds: [...quietIds],
      },
    );
    if (!claim.ok) return { ok: false, reason: 'busy', speaker: claim.speaker };

    this.armIdleTimer(client);
    this.toListeners(client, claim.talk).emit('talkie:started', { id, user });
    return { ok: true, listeners, deferred };
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
    this.toListeners(client, talk).emit('talkie:chunk', { id: talk.id, audio });
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

  /** Fin du direct, pour tous ceux qui l'entendaient, orateur compris. */
  private announceEnd(key: string, talk: Talk, cancelled: boolean) {
    this.server
      .to(key)
      .except(talk.quietUserIds.map(userRoom))
      .emit('talkie:ended', { id: talk.id, user: talk.user, cancelled });
  }

  /** Les autres connexions de la conversation, sauf celles des personnes en heures calmes. */
  private toListeners(client: TalkieSocket, talk: Talk) {
    return client
      .to(client.data.conversation.key)
      .except(talk.quietUserIds.map(userRoom));
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
