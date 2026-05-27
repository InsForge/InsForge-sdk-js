export {
  createBrowserClient,
  type CreateBrowserClientOptions,
} from './ssr/browser-client';
export {
  createServerClient,
  type CreateServerClientOptions,
} from './ssr/server-client';
export {
  createRefreshAuthRouter,
  refreshAuth,
  type RefreshAuthOptions,
  type RefreshAuthResult,
  type RefreshAuthRouteHandler,
} from './ssr/refresh';
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
  type CookieStore,
} from './ssr/cookies';
