/**
 * Unit coverage for the digest/tag parser: a trailing TAGS line splits into a
 * clean digest and lowercased de-duplicated tags; an empty line before it is
 * skipped; a missing or empty TAGS line falls back to a single tag.
 */

import { describe, expect, it } from 'vitest'
import { splitDigestAndTags } from '@deepseek-ai/dsh-memory-compaction'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

function text(...parts: string[]): ContentBlock[] {
  return parts.map(part => ({ type: 'text', text: part }))
}

describe('splitDigestAndTags', () => {
  it('splits the digest from a trailing TAGS line, de-duplicating and lowercasing', () => {
    expect(splitDigestAndTags(text('the digest body\n\nTAGS: Auth, auth, SQLite'))).toEqual({
      digestText: 'the digest body',
      tags: ['auth', 'sqlite'],
    })
  })

  it('joins multiple text blocks before parsing', () => {
    expect(splitDigestAndTags(text('part one\n', 'part two\nTAGS: a'))).toEqual({
      digestText: 'part one\npart two',
      tags: ['a'],
    })
  })

  it('skips a blank final line and still finds the TAGS line', () => {
    expect(splitDigestAndTags(text('body\nTAGS: x, y\n   \n')).tags).toEqual(['x', 'y'])
  })

  it('falls back to a single tag when no TAGS line is present', () => {
    expect(splitDigestAndTags(text('just a digest, no tags'))).toEqual({
      digestText: 'just a digest, no tags',
      tags: ['general'],
    })
  })

  it('falls back when the TAGS line names no usable tags', () => {
    expect(splitDigestAndTags(text('body\nTAGS:  ,  ,')).tags).toEqual(['general'])
  })

  it('yields an empty digest when the summary is only a TAGS line (which the engine rejects downstream)', () => {
    expect(splitDigestAndTags(text('TAGS: a, b'))).toEqual({ digestText: '', tags: ['a', 'b'] })
  })

  it('ignores non-text blocks when reading the summary', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'body\nTAGS: a' }, { type: 'tool-call', id: 'c', name: 'x', arguments: '{}' } as unknown as ContentBlock]
    expect(splitDigestAndTags(blocks).tags).toEqual(['a'])
  })
})
