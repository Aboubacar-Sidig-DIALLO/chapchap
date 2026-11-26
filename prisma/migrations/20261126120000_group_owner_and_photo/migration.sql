-- Le créateur d'un groupe en devient le propriétaire (colonne renommée : les données sont conservées).
ALTER TABLE "friend_group" RENAME COLUMN "createdById" TO "ownerId";
ALTER TABLE "friend_group" RENAME CONSTRAINT "friend_group_createdById_fkey" TO "friend_group_ownerId_fkey";

-- Photo du groupe (nom du fichier stocké).
ALTER TABLE "friend_group" ADD COLUMN "photo" TEXT;

-- Groupes dont le créateur n'est plus membre (compte supprimé, groupe quitté) :
-- le membre le plus ancien devient propriétaire.
UPDATE "friend_group" AS g
SET "ownerId" = (
  SELECT m."userId" FROM "group_member" AS m
  WHERE m."groupId" = g."id"
  ORDER BY m."joinedAt" ASC, m."userId" ASC
  LIMIT 1
)
WHERE g."ownerId" IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM "group_member" AS m
     WHERE m."groupId" = g."id" AND m."userId" = g."ownerId"
   );
