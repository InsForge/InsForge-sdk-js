import { InsForgeClient } from '../client';
import { resolveServerConfig, type SsrClientConfig } from './config';
import {
  getAccessTokenCookieName,
  getCookieValue,
  type AuthCookieSettings,
  type CookieStore,
} from './cookies';

export interface CreateServerClientOptions
  extends SsrClientConfig,
    AuthCookieSettings {
  cookies?: Pick<CookieStore, 'get'>;
  accessToken?: string;
}

export function createServerClient(
  options: CreateServerClientOptions = {},
): InsForgeClient {
  const accessToken =
    options.accessToken ??
    getCookieValue(
      options.cookies,
      getAccessTokenCookieName(options.names),
    );

  return new InsForgeClient({
    ...resolveServerConfig(options),
    isServerMode: true,
    edgeFunctionToken: accessToken ?? undefined,
  });
}
