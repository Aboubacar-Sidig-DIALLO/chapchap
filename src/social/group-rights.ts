import type { GroupRole as StoredRole } from '../generated/prisma/client';
import type {
  ConversationRights,
  GroupAction,
  GroupPermissions,
  GroupRole,
  Restriction,
} from './social.types';

/**
 * Règles des droits dans un groupe, sans accès à la base : qui a quel rôle,
 * et ce que chacun peut y faire. Le serveur les applique à chaque action ;
 * le client ne s'en sert que pour adapter l'interface.
 */

export const GROUP_ACTIONS = [
  'write',
  'voice',
  'call',
] as const satisfies readonly GroupAction[];

export const ALL_ALLOWED: GroupPermissions = {
  write: true,
  voice: true,
  call: true,
};

const NO_RESTRICTION: ConversationRights['restrictions'] = {
  write: null,
  voice: null,
  call: null,
};

/** Entre amis : chacun écrit, parle et appelle librement, sans modération. */
export const DIRECT_RIGHTS: ConversationRights = {
  moderate: false,
  restrictions: NO_RESTRICTION,
};

/** Colonnes de `Group` : ce que les simples membres peuvent faire. */
interface StoredGroupPermissions {
  membersCanWrite: boolean;
  membersCanSendVoice: boolean;
  membersCanCall: boolean;
}

/** Colonnes de `GroupMember` : restrictions propres au membre. */
interface StoredMemberPermissions {
  canWrite: boolean;
  canSendVoice: boolean;
  canCall: boolean;
}

export function groupPermissions(
  group: StoredGroupPermissions,
): GroupPermissions {
  return {
    write: group.membersCanWrite,
    voice: group.membersCanSendVoice,
    call: group.membersCanCall,
  };
}

export function toStoredGroupPermissions(
  permissions: GroupPermissions,
): StoredGroupPermissions {
  return {
    membersCanWrite: permissions.write,
    membersCanSendVoice: permissions.voice,
    membersCanCall: permissions.call,
  };
}

export function memberPermissions(
  member: StoredMemberPermissions,
): GroupPermissions {
  return {
    write: member.canWrite,
    voice: member.canSendVoice,
    call: member.canCall,
  };
}

export function toStoredMemberPermissions(
  permissions: GroupPermissions,
): StoredMemberPermissions {
  return {
    canWrite: permissions.write,
    canSendVoice: permissions.voice,
    canCall: permissions.call,
  };
}

/** Le rôle d'un membre : le propriétaire est celui que désigne le groupe. */
export function roleOf(
  ownerId: string | null,
  member: { userId: string; role: StoredRole },
): GroupRole {
  if (member.userId === ownerId) return 'owner';
  return member.role === 'ADMIN' ? 'admin' : 'member';
}

/**
 * Ce qu'un membre peut faire. Le propriétaire et les administrateurs ne sont
 * jamais restreints ; un simple membre l'est par le groupe d'abord (l'action
 * est réservée aux administrateurs), puis à titre personnel.
 */
export function rightsOf(
  role: GroupRole,
  group: GroupPermissions,
  member: GroupPermissions,
): ConversationRights {
  if (role !== 'member')
    return { moderate: true, restrictions: NO_RESTRICTION };

  const restrictionOf = (action: GroupAction): Restriction | null => {
    if (!group[action]) return 'group';
    if (!member[action]) return 'personal';
    return null;
  };
  return {
    moderate: false,
    restrictions: {
      write: restrictionOf('write'),
      voice: restrictionOf('voice'),
      call: restrictionOf('call'),
    },
  };
}

/**
 * Ce qu'exige l'envoi d'un message : un vocal demande `voice` ; du texte ou
 * tout autre fichier (image, document), `write`.
 */
export function actionsOfMessage(
  content: string,
  attachments: { voice?: unknown }[],
): GroupAction[] {
  const actions = new Set<GroupAction>();
  if (content) actions.add('write');
  for (const attachment of attachments) {
    actions.add(attachment.voice ? 'voice' : 'write');
  }
  return [...actions];
}

const RESTRICTION_MESSAGES: Record<GroupAction, Record<Restriction, string>> = {
  write: {
    group: 'Seuls les administrateurs peuvent écrire dans ce groupe',
    personal: 'Vous ne pouvez plus écrire dans ce groupe',
  },
  voice: {
    group:
      'Seuls les administrateurs peuvent envoyer des vocaux dans ce groupe',
    personal: 'Vous ne pouvez plus envoyer de vocaux dans ce groupe',
  },
  call: {
    group: 'Seuls les administrateurs peuvent lancer un appel dans ce groupe',
    personal: "Vous ne pouvez plus lancer d'appel dans ce groupe",
  },
};

/** Pourquoi ces actions sont refusées (la première interdite) ; `null` si toutes sont permises. */
export function restrictionError(
  rights: ConversationRights,
  actions: GroupAction[],
): string | null {
  for (const action of actions) {
    const restriction = rights.restrictions[action];
    if (restriction) return RESTRICTION_MESSAGES[action][restriction];
  }
  return null;
}
