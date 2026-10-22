/** Screen capture + DSH RPC helpers for the screen watch toggle. */

export interface CapturedImage {
  data: string
  mediaType: string
}

/**
 * Capture the primary screen through getDisplayMedia. Inside DeskDSH the
 * shell answers the display-media request with the primary screen (no
 * picker dialog); in a plain browser the system picker appears.
 * NOTE: displaySurface constraints make Electron reject the request with
 * NotSupportedError even when the shell answers it — keep video plain.
 */
export async function captureScreenFile(): Promise<File> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  } as DisplayMediaStreamOptions)
  try {
    const track = stream.getVideoTracks()[0]
    if (track === undefined) throw new Error('no video track')
    const video = document.createElement('video')
    video.muted = true
    video.srcObject = stream
    await video.play()
    // Let the track deliver real frames before drawing.
    await new Promise(resolve => setTimeout(resolve, 350))
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('canvas 2d unavailable')
    context.drawImage(video, 0, 0)
    track.stop()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (blob === null) throw new Error('jpeg encode failed')
    return new File([blob], 'screenshot.jpg', { type: 'image/jpeg' })
  } finally {
    for (const track of stream.getTracks()) track.stop()
  }
}

export async function captureScreen(): Promise<CapturedImage> {
  const file = await captureScreenFile()
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return { data: btoa(binary), mediaType: 'image/jpeg' }
}

type PromptContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }

/** One RPC call against the same-origin host API. */
export async function dshRpc(method: string, payload: unknown): Promise<unknown> {
  const response = await fetch(`/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method,
      payload,
    }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = await response.json()
  if (body?.result?.ok === true) return body.result.value
  const err = body?.result?.error
  throw new Error(err ? `${err.code}: ${err.message}` : 'unexpected RPC response')
}

/** Queue one message (text, optionally with one screenshot) into a session. */
export async function sendPrompt(sessionId: string, text: string, image?: CapturedImage): Promise<void> {
  const content: PromptContentPart[] = []
  if (text) content.push({ type: 'text', text })
  if (image) content.push({ type: 'image', mediaType: image.mediaType, data: image.data, name: 'screenshot.jpg' })
  if (content.length === 0) return
  await dshRpc('session.prompt', {
    sessionId,
    mode: 'queue',
    content,
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}

/** Watcher subagent management (host RPCs). */

export interface SubagentCatalogEntry {
  id: string
  kind?: string
  mode?: string
  label?: string
}

/** Find the durable continuable child labeled screen-watch under one session. */
export async function findWatcherChildId(parentSessionId: string): Promise<string | null> {
  const catalog = await dshRpc('subagent.list', { parentSessionId }) as
    | { entries?: readonly SubagentCatalogEntry[] }
    | undefined
  const entries = catalog?.entries ?? []
  const found = entries.find(entry =>
    (entry.kind === undefined || entry.kind === 'child')
    && entry.mode === 'continuable'
    && entry.label === 'screen-watch')
  return found === undefined ? null : found.id
}

/** Queue one message into the watcher child's own conversation. */
export async function sendToWatcher(
  parentSessionId: string,
  childSessionId: string,
  text: string,
  image: CapturedImage,
): Promise<void> {
  const content: PromptContentPart[] = [
    { type: 'text', text },
    { type: 'image', mediaType: image.mediaType, data: image.data, name: 'screenshot.jpg' },
  ]
  await dshRpc('subagent.prompt', {
    parentSessionId,
    childSessionId,
    mode: 'continuable',
    content,
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}

/** DeskDSH answers getDisplayMedia silently; any other browser pops the picker. */
export function runningInsideDeskDsh(): boolean {
  return navigator.userAgent.includes('Electron/')
}
