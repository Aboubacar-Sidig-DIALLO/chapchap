# chapchap

Backend NestJS de **chapchap**, une messagerie « la voix d'abord » : salon de discussion en temps réel, messages vocaux, pièces jointes et direct audio / vidéo.

## Fonctionnalités

- **Chat en temps réel** (Socket.io) : messages, historique, présence, « écrit… » / « enregistre un vocal… ».
- **Accusés** de réception et de lecture (curseurs par utilisateur).
- **Messages vocaux** : accusé « en écoute » en direct, progression d'écoute en %, « écouté ».
- **Réactions** aux messages (❤️ 😂 🔥 👏 😮 🙏), y compris sur un moment précis d'un vocal (« 🔥 à 0:42 »).
- **Réponses** à un message, ou à un passage précis d'un vocal (« à 0:42 ») : la réponse y ramène et l'écoute de là. Le serveur ne garde qu'une référence (`replyTo: { messageId, atMs? }`), jamais une copie : il vérifie que le message cité existe encore et que le moment tombe dans son vocal (pas de moment sur un vocal à écoute unique), et un message retiré ou supprimé ne survit pas dans ses réponses.
- **Pièces jointes** : envoi (10 Mo max), service avec requêtes `Range` (lecture audio sur Safari).
- **Direct** (appel audio / vidéo) : signalisation WebRTC, réactions en direct, trace de l'appel déposée dans la conversation à la fin.
- **Notifications push** (PWA) : messages, appels et demandes d'amis arrivent même application fermée, sans jamais le contenu des messages (« 🎙️ Message vocal · 0:42 »). Seuls les services push des navigateurs sont acceptés comme destination ; les abonnements morts sont effacés, ceux d'un compte aussi quand toutes ses sessions sont fermées.
- **Talkie-walkie** : en maintenant le micro, la voix est relayée en direct (PCM 16 kHz) à ceux qui ont la conversation ouverte, une voix à la fois. Le même enregistrement part ensuite comme vocal (même id) : les absents le reçoivent, les auditeurs du direct le voient déjà « écouté ». Rien n'est conservé ; droits, débit et durée sont vérifiés par le serveur.
- **Heures calmes / Ne pas déranger** : chaque jour à heure fixe (dans le fuseau de l'utilisateur, plage pouvant passer minuit), ou à la main (pour un moment, ou sans fin). Pendant ce temps, les notifications push arrivent sans son ni vibration, et le talkie-walkie ne joint plus l'utilisateur en direct : sa voix ne lui est pas relayée, il reçoit le vocal, à écouter plus tard (l'orateur en est informé). En cas de panne de lecture des réglages, personne n'est considéré « au calme » : mieux vaut un son de trop qu'un message manqué. `GET /quiet-mode`, `PUT /quiet-mode/schedule`, `PUT /quiet-mode/manual`.
- **Invités d'un appel de groupe** (sans compte) : pendant l'appel, le propriétaire ou un administrateur qui y participe crée un lien à usage unique (`POST /call-guests`). L'invité l'ouvre, choisit un nom (`POST /call-guests/:token/claim`, public) et reçoit un laissez-passer valable pour cet appel seulement : le lien ne sert plus, mais un rechargement le ramène dans l'appel. Il se connecte à un espace Socket.io à part (`/call-guests`), qui ne connaît que l'appel : chat, talkie-walkie et accueil lui restent inaccessibles par construction. Un invité ne lance ni ne prolonge un appel : quand le dernier membre part, l'appel prend fin pour tous, et liens comme laissez-passer sont effacés. Au plus 3 invités par appel ; un modérateur peut en retirer un (`call:remove-guest`). Un lien inutilisé expire au bout de 15 minutes.
- **Invitations éphémères** (lien ou QR code) : devenir ami avec leur auteur, ou rejoindre un groupe (propriétaire et administrateurs), même sans être amis. Valables 1 minute, en mémoire seulement, comme les messages ; jeton aléatoire de 192 bits ; une seule invitation active par auteur et par cible (`renew` la remplace, `DELETE /invites/:token` la désactive). À l'acceptation, tout est revérifié : invitation non expirée, auteur toujours là, toujours en droit d'ajouter au groupe, groupe pas complet. L'auteur en est prévenu (« a rejoint le groupe grâce à votre invitation »).
- **Vue unique** : un vocal, une photo, une vidéo ou un fichier que chaque destinataire n'ouvre qu'une fois. Le message n'en diffuse que l'annonce (« Vocal · 0:12 ») ; le fichier, scellé, n'est plus servi par son adresse publique. À l'ouverture (`view-once:open`), le serveur remet un ticket aléatoire, valable une minute, pour ce seul utilisateur et sa session (`GET /attachments/once/:ticket`, sans cache) ; le client le garde en mémoire le temps de l'affichage. Quand tous les destinataires l'ont ouvert, les fichiers sont effacés dans la minute ; l'auteur voit qui l'a ouvert, les autres une simple trace (« Photo vue »).

## Démarrage

```bash
pnpm install
pnpm start:dev
```

Le serveur écoute sur `http://localhost:3001`.

| Variable        | Défaut                  | Rôle                                   |
| --------------- | ----------------------- | -------------------------------------- |
| `PORT`          | `3001`                  | Port HTTP et WebSocket                 |
| `CLIENT_ORIGIN` | `http://localhost:3000` | Origine du front autorisée (CORS)      |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | — | Clés des notifications push (`npx web-push generate-vapid-keys`). Sans elles, pas de notifications. À garder : en changer désabonne tous les navigateurs. |
| `VAPID_SUBJECT` | `mailto:notifications@localhost` | Contact de l'expéditeur des notifications (`mailto:` ou `https:`), exigé par Apple en production. |

Les données (messages, accusés, direct) sont gardées en mémoire et perdues au redémarrage ; les pièces jointes sont écrites dans `uploads/`.

## Structure

```
src/
  chat/         passerelle Socket.io du salon (messages, accusés, réactions, écoute)
  call/         signalisation du direct (WebRTC) et trace des appels ; guests/ : invités sans compte
  talkie/       talkie-walkie : prise de parole et relais de la voix en direct
  push/         notifications push (PWA) : abonnements des navigateurs et envoi
  quiet-mode/   heures calmes / ne pas déranger
  invites/      invitations éphémères par lien ou QR code (ami, groupe)
  attachments/  envoi et service des pièces jointes
```

## Scripts

```bash
pnpm build       # compilation
pnpm start:prod  # lancement de la version compilée
pnpm lint        # ESLint
pnpm test        # tests unitaires
```
