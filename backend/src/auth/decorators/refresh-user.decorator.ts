import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Presents the opaque refresh-token string that RefreshGuard pulled
 *  from the HttpOnly cookie. The controller passes it straight into
 *  SessionsService.rotateSession — no JWT decoding here, because the
 *  session store IS the source of truth for what this token maps to. */
export const RefreshTokenValue = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.presentedRefreshToken as string;
  },
);
