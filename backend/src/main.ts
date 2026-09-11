import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { fixedOtpEnabled, FIXED_DEV_OTP } from './auth/utils/otp';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Global validation: every DTO with class-validator decorators gets
  // enforced automatically, and unknown fields are stripped rather
  // than silently accepted.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors();

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Onboarding API listening on :${port}`);

  // Loud on purpose. A fixed login code is the single most dangerous thing
  // that could quietly survive into a deployed environment, so it announces
  // itself every boot rather than hiding in a config file.
  if (fixedOtpEnabled()) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n  ****************************************************************\n` +
        `  *  TESTING MODE: every mobile OTP is ${FIXED_DEV_OTP}.                  *\n` +
        `  *  Any account can be logged into with a known code.           *\n` +
        `  *  Set AUTH_FIXED_OTP=false for real random codes.             *\n` +
        `  *  Refuses to engage when NODE_ENV=production.                 *\n` +
        `  ****************************************************************\n`,
    );
  }
}

bootstrap();
