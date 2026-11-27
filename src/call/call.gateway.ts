import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type {
  MessageActionAck,
  ServerToClientEvents,
  SocketData,
} from '../chat/chat.types';
import { CLIENT_ORIGIN } from '../config';
import { ConversationAccessService } from '../social/conversation-access.service';
import { restrictionError } from '../social/group-rights';
import { CallTransport } from './call-transport';
import { CallCoordinator, type CallPeer, parseMedia } from './call.coordinator';
import { CallService } from './call.service';
import type { CallJoinAck } from './call.types';
import { CallGuestsService } from './guests/call-guests.service';

type CallServer = Server<
  Record<string, never>,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type CallSocket = Socket<
  Record<string, never>,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const NO_ACCESS = "Vous n'avez plus accès à cette conversation";

function peerOf(client: CallSocket): CallPeer {
  return { peerId: client.id, user: client.data.user };
}

/**
 * Les appels vus par les membres d'une conversation, sur la connexion du chat
 * (session et accès vérifiés par ses middlewares). Le déroulement lui-même
 * est confié à `CallCoordinator`, partagé avec les invités d'un appel de groupe.
 *
 * Lancer un appel peut être réservé aux administrateurs par le propriétaire ;
 * le rejoindre, jamais. Propriétaire et administrateurs peuvent aussi retirer
 * un invité de l'appel.
 */
@WebSocketGateway({ cors: { origin: CLIENT_ORIGIN, credentials: true } })
export class CallGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  constructor(
    private readonly callService: CallService,
    private readonly coordinator: CallCoordinator,
    private readonly transport: CallTransport,
    private readonly conversationAccess: ConversationAccessService,
    private readonly callGuests: CallGuestsService,
  ) {}

  afterInit(server: CallServer) {
    this.transport.attachMembers(server);
  }

  /** Chacun voit s'il y a un appel en cours dans sa conversation, même sans y être. */
  handleConnection(client: CallSocket) {
    client.emit(
      'call:participants',
      this.coordinator.participants(client.data.conversation.key),
    );
  }

  handleDisconnect(client: CallSocket) {
    const { conversation } = client.data;
    if (conversation) this.coordinator.leave(conversation.key, client.id);
  }

  /** Lance l'appel ou y entre ; la réponse liste les participants à qui se connecter. */
  @SubscribeMessage('call:join')
  async handleJoin(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() media: unknown,
  ): Promise<CallJoinAck> {
    const startError = await this.startError(client);
    if (startError) return { ok: false, error: startError };

    const room = this.callService.room(client.data.conversation);
    return this.coordinator.join(room, peerOf(client), parseMedia(media));
  }

  /** Raccroche (entre amis, l'appel prend fin pour les deux) ou quitte le direct. */
  @SubscribeMessage('call:leave')
  handleLeave(@ConnectedSocket() client: CallSocket) {
    this.coordinator.leave(client.data.conversation.key, client.id);
  }

  /** Refuse l'appel d'un ami qui sonne, depuis la conversation. */
  @SubscribeMessage('call:decline')
  handleDecline(@ConnectedSocket() client: CallSocket) {
    this.coordinator.decline(client.data.conversation.key, client.data.user.id);
  }

  /** Micro coupé ou rétabli, caméra allumée ou éteinte. */
  @SubscribeMessage('call:media')
  handleMedia(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() media: unknown,
  ) {
    this.coordinator.setMedia(
      client.data.conversation.key,
      client.id,
      parseMedia(media),
    );
  }

  /** Relaie un message WebRTC à un autre participant du même appel (jamais au-delà). */
  @SubscribeMessage('call:signal')
  handleSignal(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() payload: unknown,
  ) {
    this.coordinator.signal(client.data.conversation.key, client.id, payload);
  }

  /** Réaction envoyée pendant l'appel : elle s'envole chez tous les participants. */
  @SubscribeMessage('call:react')
  handleReact(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() emoji: unknown,
  ) {
    this.coordinator.react(client.data.conversation.key, client.id, emoji);
  }

  /**
   * Retire un invité de l'appel du groupe : propriétaire et administrateurs
   * seulement (droits relus en base). Il ne peut plus revenir.
   */
  @SubscribeMessage('call:remove-guest')
  async handleRemoveGuest(
    @ConnectedSocket() client: CallSocket,
    @MessageBody() peerId: unknown,
  ): Promise<MessageActionAck> {
    if (typeof peerId !== 'string') {
      return { ok: false, error: 'Invité introuvable' };
    }
    const { user, conversation } = client.data;
    const rights = await this.conversationAccess.rights(user.id, conversation);
    if (!rights) return { ok: false, error: NO_ACCESS };
    if (!rights.moderate) {
      return {
        ok: false,
        error:
          'Seuls le propriétaire et les administrateurs peuvent retirer un invité',
      };
    }
    return this.callGuests.removeGuest(conversation.key, peerId)
      ? { ok: true }
      : { ok: false, error: 'Cet invité a déjà quitté l’appel' };
  }

  /**
   * Lancer un appel (personne n'y est encore) exige d'en avoir le droit, relu
   * en base ; rejoindre un appel en cours, seulement d'être membre.
   */
  private async startError(client: CallSocket): Promise<string | null> {
    const { user, conversation } = client.data;
    if (this.coordinator.participants(conversation.key).length > 0) return null;

    const rights = await this.conversationAccess.rights(user.id, conversation);
    if (!rights) return NO_ACCESS;
    return restrictionError(rights, ['call']);
  }
}
