import type { InsForgeConfig } from '../types';

export type SsrClientConfig = Omit<
  InsForgeConfig,
  'baseUrl' | 'anonKey' | 'edgeFunctionToken' | 'isServerMode' | 'auth'
> & {
  baseUrl?: string;
  anonKey?: string;
};

function env(name: string): string | undefined {
  if (typeof process === 'undefined') return undefined;
  return process.env[name];
}

export function resolveBrowserConfig(
  config: SsrClientConfig = {},
): InsForgeConfig {
  return {
    ...config,
    baseUrl: config.baseUrl ?? env('NEXT_PUBLIC_INSFORGE_URL'),
    anonKey: config.anonKey ?? env('NEXT_PUBLIC_INSFORGE_ANON_KEY'),
  };
}

export function resolveServerConfig(
  config: SsrClientConfig = {},
): InsForgeConfig {
  return {
    ...config,
    baseUrl:
      config.baseUrl ??
      env('INSFORGE_URL') ??
      env('NEXT_PUBLIC_INSFORGE_URL'),
    anonKey:
      config.anonKey ??
      env('INSFORGE_ANON_KEY') ??
      env('NEXT_PUBLIC_INSFORGE_ANON_KEY'),
  };
}
