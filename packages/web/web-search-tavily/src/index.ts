/** Register Tavily as a search provider in `ctx.web`. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import {
  TavilySearchProvider,
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_INCLUDE_ANSWER,
  TAVILY_DEFAULT_SEARCH_DEPTH,
} from './provider.ts'
import type { TavilySearchProviderOptions } from './provider.ts'

export {
  TavilySearchProvider,
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_INCLUDE_ANSWER,
  TAVILY_DEFAULT_SEARCH_DEPTH,
  TAVILY_PROVIDER_ID,
} from './provider.ts'
export type { TavilySearchProviderOptions } from './provider.ts'

/** Cordis plugin name. */
export const name = 'web-search-tavily'
/** The web service receives this provider registration. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'TAVILY_API_KEY'

/** Tavily provider configuration. */
export interface Config {
  /** Literal key; prefer `apiKeyEnv` so configuration contains no secret. */
  apiKey?: string
  /** Credential reference resolved per search. */
  apiKeyEnv?: string
  /** Endpoint base; `/search` is appended. */
  baseURL?: string
  /** Tavily search depth. */
  searchDepth?: 'basic' | 'advanced'
  /** Request Tavily's synthesized answer. */
  includeAnswer?: boolean
  /** Default result count when the caller omits `maxResults`. */
  maxResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  searchDepth: z.union(['basic', 'advanced']).default(TAVILY_DEFAULT_SEARCH_DEPTH),
  includeAnswer: z.boolean().default(TAVILY_DEFAULT_INCLUDE_ANSWER),
  maxResults: z.number().step(1).min(1),
})

/** Resolve current config and credentials for the next search. */
function resolveOptions(ctx: Context, config: Config): TavilySearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  return {
    ...config.apiKey !== undefined && config.apiKey.length > 0 ? { apiKey: config.apiKey } : {},
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? TAVILY_DEFAULT_BASE_URL,
    searchDepth: config.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
    includeAnswer: config.includeAnswer ?? TAVILY_DEFAULT_INCLUDE_ANSWER,
    ...config.maxResults !== undefined ? { maxResults: config.maxResults } : {},
  }
}

/**
 * Register Tavily in `ctx.web`; disposal removes the registration.
 * @param ctx - Cordis context providing the Web registry and optional credentials.
 * @param config - Tavily endpoint, credential reference, and search controls.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new TavilySearchProvider(() => resolveOptions(ctx, config)))
}
