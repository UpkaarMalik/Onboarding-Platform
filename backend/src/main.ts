import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// Namespace import (not `import cookieParser from ...`) because this
// project's tsconfig doesn't enable esModuleInterop and cookie-parser
// is a bare-function CommonJS module — a default import compiles to
// `cookie_parser_1.default`, which is undefined at runtime.
import * as cookieParser from 'cookie-parser';
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

  // Populates `req.cookies` — every auth cookie (access, refresh, CSRF)
  // is read through this and can't be parsed without it. Must be
  // registered BEFORE the routes that read them.
  app.use(cookieParser());

  // Cookie-carried auth requires an explicit list of allowed origins
  // (wildcard + credentials is a browser-level 400) and
  // credentials: true so the browser will actually send Set-Cookie
  // responses back on subsequent requests. CORS_ORIGIN is a
  // comma-separated env var so a single deploy can list a dev host and
  // a prod host.
  const originList =
    (config.get<string>('CORS_ORIGIN') ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  app.enableCors({
    origin: originList,
    credentials: true,
    // Frontend echoes CsrfToken back on every state-changing request;
    // the browser preflight has to see it in the allowed-headers list
    // or it will strip it before the actual request goes out.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  });

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
