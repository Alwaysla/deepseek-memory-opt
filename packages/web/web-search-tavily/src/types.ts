/**
 * Wire types for Tavily's `POST /search` API. Types only; runtime validation
 * remains at the JSON response boundary in the provider.
 * @module @deepseek-ai/dsh-web-search-tavily/types
 */

/** One Tavily search result. */
export interface TavilyResult {
  title?: string | null
  url: string
  content?: string | null
  published_date?: string | null
}

/** Tavily's search response envelope. */
export interface TavilySearchResponse {
  answer?: string | null
  results?: TavilyResult[]
}

/** Tavily's best-effort error response fields. */
export interface TavilyError {
  detail?: string | { msg?: string }[]
  error?: string
  message?: string
}
