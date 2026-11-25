import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CLIENT_ORIGIN } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: CLIENT_ORIGIN });
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
