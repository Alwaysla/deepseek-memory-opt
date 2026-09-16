import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { TavilySearchProvider } from '@deepseek-ai/dsh-web-search-tavily'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close))
})

describe('Tavily credential redirect policy', () => {
  it('rejects a redirect without contacting its target', async () => {
    let targetRequests = 0
    const target = createServer((_request, response) => {
      targetRequests += 1
      response.end('{}')
    })
    servers.push(target)
    const targetURL = await listen(target)

    const redirect = createServer((_request, response) => {
      response.writeHead(307, { location: `${targetURL}/capture` })
      response.end()
    })
    servers.push(redirect)
    const redirectURL = await listen(redirect)

    const provider = new TavilySearchProvider(() => ({
      apiKey: 'secret',
      baseURL: redirectURL,
      searchDepth: 'basic',
      includeAnswer: true,
    }))
    await expect(provider.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(targetRequests).toBe(0)
  })
})

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind a TCP port')
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}
