import type {
  ConversationSnapshot, ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'

function toolNode(node: ReturnType<ConversationSnapshot['chat']['nodes']['get']>): ChatNode<'tool-call'> | undefined {
  return node?.kind === 'tool-call' ? node as ChatNode<'tool-call'> : undefined
}

/**
 * Read one root Tool lifecycle through the internal Chat Node index.
 * @param snapshot - current Conversation snapshot.
 * @param rootCallId - provider-assigned root call identity.
 * @returns newest matching root lifecycle materialized in the current window.
 */
export function rootToolCall(
  snapshot: ConversationSnapshot,
  rootCallId: string,
): ToolCallBlock | undefined {
  for (let index = snapshot.chat.order.length - 1; index >= 0; index--) {
    const key = snapshot.chat.order[index]
    if (key === undefined) continue
    const root = toolNode(snapshot.chat.nodes.get(key))?.data.root
    if (root?.callId === rootCallId) return root
  }
  return undefined
}

/**
 * Find any root or nested Tool lifecycle through the internal Node store.
 * @param snapshot - current Conversation snapshot.
 * @param callId - root or nested call identity.
 * @returns current Tool lifecycle when materialized in the loaded window.
 */
export function findToolCall(snapshot: ConversationSnapshot, callId: string): ToolCallBlock | undefined {
  const visit = (block: ToolCallBlock): ToolCallBlock | undefined => {
    if (block.callId === callId) return block
    for (const child of block.subCalls) {
      const found = visit(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const node of snapshot.chat.nodes.values()) {
    const root = toolNode(node)?.data.root
    if (root === undefined) continue
    const found = visit(root)
    if (found !== undefined) return found
  }
  return undefined
}
