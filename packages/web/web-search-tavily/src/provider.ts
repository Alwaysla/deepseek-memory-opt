/**
 * Tavily `POST /search` implementation for the provider-neutral web service.
 * Credential resolution happens for each operation; redirects are rejected
 * before `fetch` contacts their target.
 * @module @deepseek-ai/dsh-web-search-tavily/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { TavilyError, TavilyResult, TavilySearchResponse } from './types.ts'

/** Stable provider id. */
export const TAVILY_PROVIDER_ID = 'tavily'
/** Public Tavily API base. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com'
/** Tavily's balanced search mode. */
export const TAVILY_DEFAULT_SEARCH_DEPTH = 'basic'
/** Include Tavily's synthesized answer by default. */
export const TAVILY_DEFAULT_INCLUDE_ANSWER = true

/** Resolved provider options for one search. */
export interface TavilySearchProviderOptions {
  /** Literal key; when present it wins over `resolveApiKey`. */
  apiKey?: string
  /** Resolve the current key for one operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference used by missing-key diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/search` is appended. */
  baseURL: string
  /** Tavily search depth. */
  searchDepth: 'basic' | 'advanced'
  /** Whether Tavily should synthesize an answer. */
  includeAnswer: boolean
  /** Default result count when the request omits `maxResults`. */
  maxResults?: number
}

/**
 * Map one Tavily result, dropping entries without portable snippets.
 * @param result - Tavily result to normalize.
 * @returns a portable source, or `undefined` when no snippet is available.
 */
export function mapTavilyResult(result: TavilyResult): WebSearchSource | undefined {
  const snippet = result.content?.trim()
  if (snippet === undefined || snippet.length === 0) return undefined
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    snippet,
    ...result.published_date != null && result.published_date.length > 0
      ? { publishedAt: result.published_date }
      : {},
  }
}

/**
 * Map Tavily's response to the provider-neutral result.
 * @param response - Tavily search response to normalize.
 * @returns the provider-neutral search result.
 */
export function mapTavilyResponse(response: TavilySearchResponse): WebSearchResult {
  if (response.results !== undefined && !Array.isArray(response.results)) {
    throw new TypeError('Tavily response results must be an array')
  }
  return {
    ...typeof response.answer === 'string' && response.answer.trim().length > 0
      ? { content: response.answer }
      : {},
    sources: (response.results ?? []).map(mapTavilyResult)
      .filter((source): source is WebSearchSource => source !== undefined),
    truncated: false,
  }
}

/** Tavily-backed search provider. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = TAVILY_PROVIDER_ID

  /**
   * Create a provider that resolves current settings before each operation.
   * @param resolveOptions - Supplies endpoint, search controls, and credentials.
   */
  constructor(private readonly resolveOptions: () => TavilySearchProviderOptions) {}

  /** @returns whether endpoint, credential source, and result count are locally usable. */
  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined)
      && isHttpBaseURL(options.baseURL)
      && (options.maxResults === undefined || isPositiveInteger(options.maxResults))
  }

  /**
   * Search Tavily and normalize its answer and sources.
   * @param request - Provider-neutral query and optional source limit.
   * @param signal - Optional caller cancellation signal.
   * @returns normalized generated content and citeable sources.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)
    throwIfAborted(signal)
    const maxResults = request.maxResults ?? options.maxResults
    let response: Response
    try {
      const endpoint = new URL('search', withTrailingSlash(options.baseURL))
      response = await fetch(endpoint.toString(), {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': 'deepseek-harness/0.0.1',
        },
        body: JSON.stringify({
          query: request.query,
          search_depth: options.searchDepth,
          include_answer: options.includeAnswer,
          ...maxResults !== undefined ? { max_results: maxResults } : {},
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(error)
      throw new WebError(`Tavily search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) {
      let message = `Tavily API error (HTTP ${response.status})`
      try {
        message = errorDetail(await response.json() as TavilyError) ?? message
      } catch (error) {
        if (signal?.aborted === true || isAbortError(error)) throw aborted(error)
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }
    try {
      return mapTavilyResponse(await response.json() as TavilySearchResponse)
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(error)
      throw new WebError(`Tavily returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  private async apiKey(options: TavilySearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await options.resolveApiKey?.()
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw aborted(error)
      throw new WebError(`Tavily credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    throwIfAborted(signal)
    if (resolved !== undefined && resolved.length > 0) return resolved
    throw new WebError(
      `Tavily search has no API key for "${options.apiKeyEnv ?? 'TAVILY_API_KEY'}"; store it through the credentials service or export it in the launching environment`,
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

function errorDetail(error: TavilyError): string | undefined {
  if (typeof error.detail === 'string' && error.detail.length > 0) return error.detail
  const nested = Array.isArray(error.detail) ? error.detail.find(value => typeof value.msg === 'string')?.msg : undefined
  return nested ?? error.error ?? error.message
}

function withTrailingSlash(baseURL: string): string {
  return baseURL.endsWith('/') ? baseURL : `${baseURL}/`
}

function isHttpBaseURL(value: string): boolean {
  if (!URL.canParse(value)) return false
  const protocol = new URL(value).protocol
  return protocol === 'http:' || protocol === 'https:'
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw aborted(signal.reason)
}

function aborted(cause: unknown): WebError {
  return new WebError('Tavily search aborted', 'WEB_ABORTED', { cause })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
