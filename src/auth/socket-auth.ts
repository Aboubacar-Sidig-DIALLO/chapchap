import { fromNodeHeaders } from 'better-auth/node';
import type { Socket } from 'socket.io';
import type { ChatUser } from '../chat/chat.types';
import { auth } from './auth';

/** Ce que `authenticateSocket` garantit sur toute connexion acceptée. */
export interface AuthSocketData {
  user: ChatUser;
}

type AuthenticatedSocket = Socket<any, any, any, AuthSocketData>;

/** Utilisateur de la session portée par le cookie de la poignée de main, s'il y en a une. */
async function getSocketUser(
  socket: AuthenticatedSocket,
): Promise<ChatUser | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(socket.handshake.headers),
  });
  return session ? { id: session.user.id, name: session.user.name } : null;
}

/**
 * Middleware Socket.io : n'accepte que les connexions portant un cookie de
 * session valide, et en déduit l'identité de l'utilisateur. Le client ne peut
 * donc pas se faire passer pour quelqu'un d'autre.
 *
 * Exécuté avant la connexion : `socket.data.user` est garanti dans tous les
 * gestionnaires d'événements.
 */
export function authenticateSocket(
  socket: AuthenticatedSocket,
  next: (error?: Error) => void,
) {
  getSocketUser(socket)
    .then((user) => {
      if (!user) return next(new Error('UNAUTHORIZED'));
      socket.data.user = user;
      next();
    })
    .catch(() => next(new Error('UNAUTHORIZED')));
}
