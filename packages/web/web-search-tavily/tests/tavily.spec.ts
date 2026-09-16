import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebRuntime from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-credentials'
import * as tavilyPlugin from '@deepseek-ai/dsh-web-search-tavily'
import { TavilySearchProvider, TAVILY_PROVIDER_ID } from '@deepseek-ai/dsh-web-search-tavily'
import { mapTavilyResponse } from '../src/provider.ts'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const options = {
  apiKey: 'test-key',
  baseURL: 'https://example.test',
  searchDepth: 'basic' as const,
  includeAnswer: true,
}

afterEach(() => vi.unstubAllGlobals())

describe('TavilySearchProvider', () => {
  it('maps answer, snippets, and publication timestamps', () => {
    expect(mapTavilyResponse({
      answer: 'answer',
      results: [
        { url: 'https://example.test/a', title: 'A', content: ' snippet ', published_date: '2026-01-01' },
        { url: 'https://example.test/empty', content: ' ' },
      ],
    })).toEqual({
      content: 'answer',
      sources: [{
        url: 'https://example.test/a',
        title: 'A',
        snippet: 'snippet',
        publishedAt: '2026-01-01',
      }],
      truncated: false,
    })
  })

  it('posts Tavily request fields with bearer authorization', async () => {
    const fetchMock = vi.fn(async () => response({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new TavilySearchProvider(() => ({
      ...options,
      baseURL: 'https://example.test/api',
    }))
    await provider.search({ query: 'query', maxResults: 4 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://example.test/api/search')
    expect(init.redirect).toBe('error')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'query',
      search_depth: 'basic',
      include_answer: true,
      max_results: 4,
    })
  })

  it('maps API, network, parse, missing-key, and abort failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ detail: [{ msg: 'bad query' }] }, 400)))
    await expect(new TavilySearchProvider(() => options).search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'bad query' })

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(new TavilySearchProvider(() => options).search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 200 })))
    await expect(new TavilySearchProvider(() => options).search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })

    const { apiKey: _apiKey, ...withoutApiKey } = options
    await expect(new TavilySearchProvider(() => ({ ...withoutApiKey })).search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })

    const controller = new AbortController()
    controller.abort('stop')
    await expect(new TavilySearchProvider(() => options).search({ query: 'q' }, controller.signal))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('reports availability from credentials, URL, and result count', () => {
    expect(new TavilySearchProvider(() => options).available()).toBe(true)
    expect(new TavilySearchProvider(() => ({ ...options, baseURL: ':' })).available()).toBe(false)
    expect(new TavilySearchProvider(() => ({ ...options, baseURL: 'mailto:user@example.test' })).available()).toBe(false)
    expect(new TavilySearchProvider(() => ({ ...options, maxResults: 0 })).available()).toBe(false)
    const { apiKey: _apiKey, ...withoutApiKey } = options
    expect(new TavilySearchProvider(() => withoutApiKey).available()).toBe(false)
    expect(new TavilySearchProvider(() => ({ ...withoutApiKey, resolveApiKey: async () => 'key' })).available()).toBe(true)
  })
})

describe('web-search-tavily plugin', () => {
  it('registers and disposes the provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ results: [] })))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: TAVILY_PROVIDER_ID })
    const fiber = await ctx.plugin(tavilyPlugin, { apiKey: 'test-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    await ctx.fiber.dispose()
  })

  it('uses namespace exports without a default export', () => {
    expect('default' in tavilyPlugin).toBe(false)
    expect(tavilyPlugin.inject).toEqual(['web'])
  })
})
