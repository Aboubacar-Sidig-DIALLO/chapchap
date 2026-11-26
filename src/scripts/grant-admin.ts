import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { prisma } from '../database/prisma';

/** 18 octets aléatoires : 24 caractères, bien au-delà du minimum de 12. */
const PASSWORD_BYTES = 18;

/**
 * Nomme un administrateur, par l'adresse email de son compte :
 * `pnpm admin:grant alice@example.com` (version compilée : après `pnpm build`,
 * ou pendant `pnpm start:dev`).
 *
 * Un administrateur se connecte avec un mot de passe : le script en génère un,
 * l'affiche une seule fois, et ferme ses sessions ouvertes sans mot de passe.
 * Relancé sur un administrateur, il lui donne un nouveau mot de passe (oubli).
 *
 * Indispensable pour le premier administrateur ; les suivants se nomment
 * depuis l'interface d'administration.
 */
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage : pnpm admin:grant <email>');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) {
    console.error(`Aucun compte avec l'adresse ${email}`);
    process.exitCode = 1;
    return;
  }

  const password = randomBytes(PASSWORD_BYTES).toString('base64url');
  const hashed = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { role: 'admin' } });
    // Compte « mot de passe » de Better Auth (`credential`), créé ou remplacé.
    const credential = await tx.account.findFirst({
      where: { userId: user.id, providerId: 'credential' },
      select: { id: true },
    });
    if (credential) {
      await tx.account.update({
        where: { id: credential.id },
        data: { password: hashed },
      });
    } else {
      await tx.account.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          accountId: user.id,
          providerId: 'credential',
          password: hashed,
        },
      });
    }
    await tx.session.deleteMany({ where: { userId: user.id } });
  });

  console.log(`${email} est administrateur.`);
  console.log(`Mot de passe : ${password}`);
  console.log(
    "Il n'est affiché qu'une fois : changez-le dans votre profil après vous être connecté.",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
