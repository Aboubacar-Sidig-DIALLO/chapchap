-- Rôles des membres d'un groupe : les administrateurs ajoutent des membres et suppriment des messages.
CREATE TYPE "GroupRole" AS ENUM ('MEMBER', 'ADMIN');
ALTER TABLE "group_member" ADD COLUMN "role" "GroupRole" NOT NULL DEFAULT 'MEMBER';

-- Restrictions d'un membre en particulier.
ALTER TABLE "group_member" ADD COLUMN "canWrite" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "group_member" ADD COLUMN "canSendVoice" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "group_member" ADD COLUMN "canCall" BOOLEAN NOT NULL DEFAULT true;

-- Restrictions de tous les membres d'un groupe à la fois.
ALTER TABLE "friend_group" ADD COLUMN "membersCanWrite" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "friend_group" ADD COLUMN "membersCanSendVoice" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "friend_group" ADD COLUMN "membersCanCall" BOOLEAN NOT NULL DEFAULT true;
