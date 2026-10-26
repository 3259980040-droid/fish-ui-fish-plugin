import { expect, it } from 'vitest'
import { parseKnowledgeOpened, parseKnowledgeSearch } from '../src/client/parsers.ts'

it('keeps document source, author, references and revision when parsing a search and its original', () => {
  const source = {
    scope: 'chat:group:12345', source: 'qq-attachment', version: 2, parent_version: 'prior-doc',
    metadata: { sender_id: '30001', source_reference: 'message:qq:32' },
    links: [{ reference: 'message:qq:32', created: 100 }],
  }
  const found = parseKnowledgeSearch({ query: '星环观测站', hits: [{
    ...source, reference: 'doc:star:1', kind: 'document', channel: 'documents',
    levels: { index: { matched_by: 'fts5' }, overview: {}, original: { available: true } },
  }], retrieval: { semantic: { channels: { documents: { status: 'no-match', ready: true, unindexed: 1 } } } } })
  expect(found.ok).toBe(true)
  if (!found.ok) throw new Error(found.failure.message)
  expect(found.value.hits[0]?.origin).toEqual({
    scope: 'chat:group:12345', source: 'qq-attachment', sender: '30001', quote: '',
    references: ['message:qq:32'], version: 2, parent_version: 'prior-doc',
  })
  expect(found.value.retrieval.semantic.channels.documents).toMatchObject({
    status: 'no-match', ready: true, unindexed: 1,
  })
  const opened = parseKnowledgeOpened({ ...source, reference: 'doc:star', kind: 'document', doc_id: 'star', preview: [] })
  expect(opened.ok).toBe(true)
  if (!opened.ok || opened.value.kind !== 'document') throw new Error('Expected the document original')
  expect(opened.value.origin).toEqual(found.value.hits[0]?.origin)
})
