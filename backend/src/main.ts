import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// Namespace import (not `import cookieParser from ...`) because this
// project's tsconfig doesn't enable esModuleInterop and cookie-parser
// is a bare-function CommonJS module — a default import compiles to
// `cookie_parser_1.default`, which is undefined at runtime.
import * as cookieParser from 'cookie-parser';
// Default import, unlike cookie-parser above: helmet's CJS bundle sets
// `module.exports.default = module.exports`, so `helmet_1.default` is
// the function. tsconfig has allowSyntheticDefaultImports.
import helmet from 'helmet';
import { AppModule } from './app.module';
import { resolveCookiePolicy } from './auth/sessions/session-cookies.util';
// OTP-LOGIN-DISABLED
// import { fixedOtpEnabled, FIXED_DEV_OTP } from './auth/utils/otp';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Same source of truth the session cookies use, so HSTS and the
  // Secure flag can never disagree about whether this deploy is HTTPS.
  const cookiePolicy = resolveCookiePolicy(config);

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

  // First middleware in the chain: a header that only gets attached on
  // the happy path is not a security header. Registered before the
  // routes so it covers 404s and thrown exceptions too.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          // This server answers JSON and file downloads. The Vite dev
          // origin is listed because CORS_ORIGIN is the one place that
          // knows where the frontend lives; note that a CSP on an API
          // response constrains almost nothing on its own — the policy
          // that matters for XSS is the one the frontend serves with
          // its own HTML.
          'connect-src': ["'self'", ...originList],
          // Nothing this server returns is ever meant to be framed.
          'frame-ancestors': ["'none'"],
          // In helmet's defaults, and it would rewrite plain-http
          // requests in local development.
          'upgrade-insecure-requests': cookiePolicy.secure ? [] : null,
        },
      },
      // Only promise HTTPS when this deploy is actually on HTTPS.
      // Sending HSTS from an http origin is ignored by browsers, but
      // sending it from a staging box that later drops to http locks
      // that hostname out of plain http for a year.
      hsts: cookiePolicy.secure
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
      // helmet defaults this to same-origin, which is wrong for an API
      // on :3000 whose only callers are on another port.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

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

  app.enableCors({
    origin: originList,
    credentials: true,
    // Frontend echoes CsrfToken back on every state-changing request;
    // the browser preflight has to see it in the allowed-headers list
    // or it will strip it before the actual request goes out.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    // Retry-After is not one of the seven headers a browser exposes to
    // JavaScript by default, so without this the login form can read
    // the 429 body but not how long the block has left to run.
    exposedHeaders: ['Retry-After'],
  });

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Onboarding API listening on :${port}`);

  // OTP-LOGIN-DISABLED — the fixed-code banner went with the OTP login
  // method. Nothing issues an OTP any more, so warning about a fixed one
  // would be noise. Uncomment alongside the rest of the OTP flow.
  //
  // // Loud on purpose. A fixed login code is the single most dangerous thing
  // // that could quietly survive into a deployed environment, so it announces
  // // itself every boot rather than hiding in a config file.
  // if (fixedOtpEnabled()) {
  //   // eslint-disable-next-line no-console
  //   console.warn(
  //     `\n  ****************************************************************\n` +
  //       `  *  TESTING MODE: every mobile OTP is ${FIXED_DEV_OTP}.                  *\n` +
  //       `  *  Any account can be logged into with a known code.           *\n` +
  //       `  *  Set AUTH_FIXED_OTP=false for real random codes.             *\n` +
  //       `  *  Refuses to engage when NODE_ENV=production.                 *\n` +
  //       `  ****************************************************************\n`,
  //   );
  // }
}

bootstrap();
