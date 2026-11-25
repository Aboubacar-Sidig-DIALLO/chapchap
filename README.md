# chapchap

Backend NestJS de **chapchap**, une messagerie « la voix d'abord » : salon de discussion en temps réel, messages vocaux, pièces jointes et direct audio / vidéo.

## Fonctionnalités

- **Chat en temps réel** (Socket.io) : messages, historique, présence, « écrit… » / « enregistre un vocal… ».
- **Accusés** de réception et de lecture (curseurs par utilisateur).
- **Messages vocaux** : accusé « en écoute » en direct, progression d'écoute en %, « écouté ».
- **Réactions** aux messages (❤️ 😂 🔥 👏 😮 🙏).
- **Pièces jointes** : envoi (10 Mo max), service avec requêtes `Range` (lecture audio sur Safari).
- **Direct** (appel audio / vidéo) : signalisation WebRTC, réactions en direct, trace de l'appel déposée dans la conversation à la fin.

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

Les données (messages, accusés, direct) sont gardées en mémoire et perdues au redémarrage ; les pièces jointes sont écrites dans `uploads/`.

## Structure

```
src/
  chat/         passerelle Socket.io du salon (messages, accusés, réactions, écoute)
  call/         signalisation du direct (WebRTC) et trace des appels
  attachments/  envoi et service des pièces jointes
```

## Scripts

```bash
pnpm build       # compilation
pnpm start:prod  # lancement de la version compilée
pnpm lint        # ESLint
pnpm test        # tests unitaires
```
