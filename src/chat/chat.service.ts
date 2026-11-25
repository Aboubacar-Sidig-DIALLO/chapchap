import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { CLEANUP_INTERVAL_MS } from './chat.constants';
import type { ChatUser } from './chat.types';
import { ConversationStore } from './conversation-store';

interface Connection {
  user: ChatUser;
  conversationKey: string;
}

/**
 * Toutes les conversations en cours, en mémoire uniquement : un redémarrage
 * les efface, et chaque message disparaît une heure après son envoi.
 */
@Injectable()
export class ChatService implements OnModuleInit, OnModuleDestroy {
  private readonly stores = new Map<string, ConversationStore>();
  /** Par identifiant de connexion (un onglet). */
  private readonly connections = new Map<string, Connection>();
  private cleanupTimer?: NodeJS.Timeout;

  onModuleInit() {
    this.cleanupTimer = setInterval(
      () => this.removeExpired(),
      CLEANUP_INTERVAL_MS,
    );
    // Le ménage ne doit pas empêcher le processus de s'arrêter.
    this.cleanupTimer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  /** La conversation `key`, créée à la première utilisation. */
  conversation(key: string): ConversationStore {
    let store = this.stores.get(key);
    if (!store) {
      store = new ConversationStore();
      this.stores.set(key, store);
    }
    return store;
  }

  /** Efface tous les messages d'une conversation (ex. amitié rompue). */
  deleteConversation(key: string) {
    this.stores.delete(key);
  }

  addConnection(socketId: string, user: ChatUser, conversationKey: string) {
    this.connections.set(socketId, { user, conversationKey });
  }

  removeConnection(socketId: string) {
    this.connections.delete(socketId);
  }

  /**
   * Personnes présentes dans une conversation, dédoublonnées (un même
   * utilisateur peut ouvrir plusieurs onglets).
   */
  getOnlineUsers(conversationKey: string): ChatUser[] {
    const users = new Map<string, ChatUser>();
    for (const connection of this.connections.values()) {
      if (connection.conversationKey === conversationKey) {
        users.set(connection.user.id, connection.user);
      }
    }
    return [...users.values()];
  }

  /**
   * Efface les messages expirés, puis les conversations vides où plus
   * personne n'est connecté (leurs accusés de lecture avec elles).
   */
  removeExpired(now = Date.now()) {
    const activeKeys = new Set(
      [...this.connections.values()].map((c) => c.conversationKey),
    );
    for (const [key, store] of this.stores) {
      if (store.pruneExpired(now) && !activeKeys.has(key)) {
        this.stores.delete(key);
      }
    }
  }
}
