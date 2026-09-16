import { describe, expect, it } from 'vitest'
import {
  TavilySearchProvider,
  TAVILY_DEFAULT_BASE_URL,
  TAVILY_DEFAULT_INCLUDE_ANSWER,
  TAVILY_DEFAULT_SEARCH_DEPTH,
} from '@deepseek-ai/dsh-web-search-tavily'

const apiKey = process.env.TAVILY_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('TavilySearchProvider real API', () => {
  it('returns sources for a live query', async () => {
    const provider = new TavilySearchProvider(() => ({
      apiKey: apiKey!,
      baseURL: process.env.TAVILY_BASE_URL ?? TAVILY_DEFAULT_BASE_URL,
      searchDepth: TAVILY_DEFAULT_SEARCH_DEPTH,
      includeAnswer: TAVILY_DEFAULT_INCLUDE_ANSWER,
    }))
    const result = await provider.search({ query: 'DeepSeek Harness', maxResults: 3 })
    expect(result.sources.length).toBeGreaterThan(0)
  }, 30_000)
})
