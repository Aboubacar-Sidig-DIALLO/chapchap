import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CLIENT_ORIGIN } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Better Auth lit lui-même le corps de ses requêtes ; le module
    // d'authentification remet les parseurs habituels pour les autres routes.
    bodyParser: false,
  });
  // `credentials` : le front envoie le cookie de session avec ses requêtes.
  app.enableCors({ origin: CLIENT_ORIGIN, credentials: true });
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
