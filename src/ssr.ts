export { createBrowserClient, type CreateBrowserClientOptions } from './ssr/browser-client';
export { createServerClient, type CreateServerClientOptions } from './ssr/server-client';
export {
  createRefreshAuthRouter,
  refreshAuth,
  type RefreshAuthOptions,
  type RefreshAuthResult,
  type RefreshAuthRouteHandler,
} from './ssr/refresh';
export {
  createAuthActions,
  type AuthActions,
  type CreateAuthActionsOptions,
} from './ssr/auth-actions';
export {
  updateSession,
  type UpdateSessionOptions,
  type UpdateSessionResult,
} from './ssr/update-session';
export {
  DEFAULT_ACCESS_TOKEN_COOKIE,
  DEFAULT_REFRESH_TOKEN_COOKIE,
  accessTokenCookieOptions,
  refreshTokenCookieOptions,
  setAuthCookies,
  clearAuthCookies,
  getAccessTokenCookieName,
  getRefreshTokenCookieName,
  type AuthCookieNames,
  type AuthCookieOptions,
  type AuthCookieSettings,
  type CookieOptions,
  type CookieReader,
  type CookieStore,
  type CookieWriter,
} from './ssr/cookies';
