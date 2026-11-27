import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { ChatUser } from '../../chat/chat.types';
import { CLIENT_ORIGIN } from '../../config';
import { CallTransport } from '../call-transport';
import { CallCoordinator, parseMedia } from '../call.coordinator';
import type { CallJoinAck, GuestServerEvents } from '../call.types';
import { GUEST_NAMESPACE, GUEST_TOKEN_PATTERN } from './call-guests.constants';
import { CallGuestsService } from './call-guests.service';

/** Ce que le middleware garantit sur toute connexion d'invité acceptée. */
interface GuestSocketData {
  guest: ChatUser;
  /** Conversation du groupe dont il suit l'appel. */
  conversationKey: string;
  /** Son laissez-passer, revérifié à chaque entrée dans l'appel. */
  pass: string;
}

type GuestNamespace = Namespace<
  Record<string, never>,
  GuestServerEvents,
  Record<string, never>,
  GuestSocketData
>;
type GuestSocket = Socket<
  Record<string, never>,
  GuestServerEvents,
  Record<string, never>,
  GuestSocketData
>;

/** Refus de connexion : laissez-passer inconnu, retiré, ou appel terminé. */
const CALL_ENDED = 'CALL_ENDED';

/**
 * Invités d'un appel de groupe, sans compte. Ils se connectent à un espace
 * Socket.io à part (`/call-guests`), qui ne connaît que l'appel : le chat, le
 * talkie-walkie et l'accueil sont sur l'espace principal, réservé aux
 * sessions. Un invité ne peut donc rien y faire d'autre, par construction.
 */
@WebSocketGateway({
  namespace: GUEST_NAMESPACE,
  cors: { origin: CLIENT_ORIGIN },
})
export class GuestCallGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  // `!` : assigné par Nest après la construction (`@WebSocketServer`).
  @WebSocketServer()
  private readonly namespace!: GuestNamespace;

  constructor(
    private readonly coordinator: CallCoordinator,
    private readonly transport: CallTransport,
    private readonly callGuests: CallGuestsService,
  ) {}

  /** N'accepte qu'un laissez-passer valable, pour un appel encore en cours. */
  afterInit(namespace: GuestNamespace) {
    this.transport.attachGuests(namespace);
    namespace.use((socket, next) => {
      const { pass } = (socket.handshake.auth ?? {}) as Record<string, unknown>;
      const found =
        typeof pass === 'string' && GUEST_TOKEN_PATTERN.test(pass)
          ? this.callGuests.authenticate(pass)
          : null;
      if (!found) return next(new Error(CALL_ENDED));

      socket.data.guest = found.pass.guest;
      socket.data.conversationKey = found.room.key;
      socket.data.pass = found.pass.pass;
      next();
    });
  }

  handleConnection(client: GuestSocket) {
    const { guest, conversationKey } = client.data;
    // Un seul onglet par invité : l'ancienne connexion (page rechargée…) cède la place.
    for (const other of this.namespace.sockets.values()) {
      if (other.id !== client.id && other.data.guest?.id === guest.id) {
        other.disconnect(true);
      }
    }
    void client.join(conversationKey);
    client.emit(
      'call:participants',
      this.coordinator.participants(conversationKey),
    );
  }

  handleDisconnect(client: GuestSocket) {
    const { conversationKey } = client.data;
    if (conversationKey) this.coordinator.leave(conversationKey, client.id);
  }

  /** Entre dans l'appel, s'il est toujours en cours et le laissez-passer toujours valable. */
  @SubscribeMessage('call:join')
  handleJoin(
    @ConnectedSocket() client: GuestSocket,
    @MessageBody() media: unknown,
  ): CallJoinAck {
    const found = this.callGuests.authenticate(client.data.pass);
    if (!found) return { ok: false, error: 'L’appel est terminé' };
    return this.coordinator.join(
      found.room,
      { peerId: client.id, user: client.data.guest },
      parseMedia(media),
    );
  }

  @SubscribeMessage('call:leave')
  handleLeave(@ConnectedSocket() client: GuestSocket) {
    this.coordinator.leave(client.data.conversationKey, client.id);
  }

  @SubscribeMessage('call:media')
  handleMedia(
    @ConnectedSocket() client: GuestSocket,
    @MessageBody() media: unknown,
  ) {
    this.coordinator.setMedia(
      client.data.conversationKey,
      client.id,
      parseMedia(media),
    );
  }

  @SubscribeMessage('call:signal')
  handleSignal(
    @ConnectedSocket() client: GuestSocket,
    @MessageBody() payload: unknown,
  ) {
    this.coordinator.signal(client.data.conversationKey, client.id, payload);
  }

  @SubscribeMessage('call:react')
  handleReact(
    @ConnectedSocket() client: GuestSocket,
    @MessageBody() emoji: unknown,
  ) {
    this.coordinator.react(client.data.conversationKey, client.id, emoji);
  }
}
