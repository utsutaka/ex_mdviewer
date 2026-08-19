import { describe, expect, it } from 'vitest'
import { toStructuredNodeFromJson } from '../../../src/renderer/structured-data/json-adapter'
import { yamlToStructuredNodes } from '../../../src/main/yaml-adapter'

describe('toStructuredNodeFromJson', () => {
  it('オブジェクトをkind: objectのノードへ変換し、キーごとの子ノードを持つ', () => {
    const node = toStructuredNodeFromJson({ a: 1, b: 'x' })
    expect(node.kind).toBe('object')
    expect(node.children).toHaveLength(2)
    expect(node.children[0].key).toBe('a')
    expect(node.children[0].kind).toBe('number')
    expect(node.children[0].value).toBe(1)
    expect(node.children[1].key).toBe('b')
    expect(node.children[1].kind).toBe('string')
    expect(node.children[1].value).toBe('x')
  })

  it('配列をkind: arrayのノードへ変換し、キーがnullの子ノードを持つ', () => {
    const node = toStructuredNodeFromJson([1, 2, 3])
    expect(node.kind).toBe('array')
    expect(node.children).toHaveLength(3)
    expect(node.children.every((c) => c.key === null)).toBe(true)
  })

  it('4種のスカラー値（文字列・数値・真偽値・null）を正しいkindへ変換する', () => {
    const node = toStructuredNodeFromJson({
      s: 'text',
      n: 42,
      b: true,
      nu: null
    })
    expect(node.children[0].kind).toBe('string')
    expect(node.children[1].kind).toBe('number')
    expect(node.children[2].kind).toBe('boolean')
    expect(node.children[2].value).toBe(true)
    expect(node.children[3].kind).toBe('null')
    expect(node.children[3].value).toBeNull()
  })

  it('ネストしたオブジェクト・配列を再帰的に変換する', () => {
    const node = toStructuredNodeFromJson({ list: [{ x: 1 }] })
    const list = node.children[0]
    expect(list.kind).toBe('array')
    const item = list.children[0]
    expect(item.kind).toBe('object')
    expect(item.children[0].key).toBe('x')
    expect(item.children[0].value).toBe(1)
  })

  it('空オブジェクト・空配列はchildren: []になる', () => {
    const node = toStructuredNodeFromJson({ obj: {}, arr: [] })
    expect(node.children[0].children).toEqual([])
    expect(node.children[1].children).toEqual([])
  })

  it('ルートからのjsonPointerを算出する（RFC 6901準拠）', () => {
    const node = toStructuredNodeFromJson({ a: [{ b: 1 }] })
    expect(node.jsonPointer).toBe('')
    expect(node.children[0].jsonPointer).toBe('/a')
    expect(node.children[0].children[0].jsonPointer).toBe('/a/0')
    expect(node.children[0].children[0].children[0].jsonPointer).toBe('/a/0/b')
  })

  it('jsonPointerのキーに含まれる~と/をRFC 6901のエスケープ規則で変換する', () => {
    const node = toStructuredNodeFromJson({ 'a/b': { 'c~d': 1 } })
    expect(node.children[0].jsonPointer).toBe('/a~1b')
    expect(node.children[0].children[0].jsonPointer).toBe('/a~1b/c~0d')
  })

  it('キーが$refかつ値が#/で始まる文字列の場合、isRefAlias: trueになる', () => {
    const node = toStructuredNodeFromJson({ $ref: '#/components/schemas/Pet' })
    expect(node.children[0].isRefAlias).toBe(true)
  })

  it('$refの値が別ファイル参照・外部URL参照の場合、isRefAlias: falseになる', () => {
    const node = toStructuredNodeFromJson({
      local: './other.yaml#/x',
      url: 'https://example.com/schema.json'
    })
    const refs = { local: node.children[0], url: node.children[1] }
    expect(refs.local.key).toBe('local')
    expect(refs.local.isRefAlias).toBe(false)
    expect(refs.url.isRefAlias).toBe(false)
  })

  it('$ref以外のキーはisRefAlias: falseになる', () => {
    const node = toStructuredNodeFromJson({ ref: '#/x' })
    expect(node.children[0].isRefAlias).toBe(false)
  })
})

describe('yamlToStructuredNodes', () => {
  it('単純なマッピングをkind: objectのノードへ変換する', () => {
    const groups = yamlToStructuredNodes('a: 1\nb: text\n')
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Document 1')
    const root = groups[0].root
    expect(root.kind).toBe('object')
    expect(root.children[0].key).toBe('a')
    expect(root.children[0].value).toBe(1)
    expect(root.children[1].key).toBe('b')
    expect(root.children[1].value).toBe('text')
  })

  it('アンカー・エイリアスの値をそのまま展開し、参照元アンカー名をanchorLabelへ設定する', () => {
    const groups = yamlToStructuredNodes('base: &b\n  x: 1\nref: *b\n')
    const root = groups[0].root
    const refNode = root.children.find((c) => c.key === 'ref')
    expect(refNode).toBeDefined()
    expect(refNode?.kind).toBe('object')
    expect(refNode?.anchorLabel).toBe('b')
    expect(refNode?.children[0].key).toBe('x')
    expect(refNode?.children[0].value).toBe(1)
  })

  it('アンカー定義元ノードへのjsonPointerをanchorRefPointerへ設定する', () => {
    const groups = yamlToStructuredNodes('base: &b\n  x: 1\nref: *b\n')
    const root = groups[0].root
    const refNode = root.children.find((c) => c.key === 'ref')
    expect(refNode?.anchorRefPointer).toBe('/base')
  })

  it('アンカー定義元ノード自体はanchorLabel/anchorRefPointerともnullのまま', () => {
    const groups = yamlToStructuredNodes('base: &b\n  x: 1\nref: *b\n')
    const root = groups[0].root
    const baseNode = root.children.find((c) => c.key === 'base')
    expect(baseNode?.anchorLabel).toBeNull()
    expect(baseNode?.anchorRefPointer).toBeNull()
  })

  it('---区切りの複数ドキュメントをDocument N見出し付きで分割する', () => {
    const groups = yamlToStructuredNodes('a: 1\n---\nb: 2\n')
    expect(groups).toHaveLength(2)
    expect(groups[0].label).toBe('Document 1')
    expect(groups[1].label).toBe('Document 2')
    expect(groups[0].root.children[0].key).toBe('a')
    expect(groups[1].root.children[0].key).toBe('b')
  })

  it('構文的に不正なYAMLの場合は例外をthrowする', () => {
    expect(() => yamlToStructuredNodes('a: [1, 2\n')).toThrow()
  })

  it('ネストしたマッピング・シーケンスからjsonPointerを算出する', () => {
    const groups = yamlToStructuredNodes('a:\n  - x: 1\n')
    const root = groups[0].root
    expect(root.jsonPointer).toBe('')
    expect(root.children[0].jsonPointer).toBe('/a')
    expect(root.children[0].children[0].jsonPointer).toBe('/a/0')
    expect(root.children[0].children[0].children[0].jsonPointer).toBe('/a/0/x')
  })

  it('キーが$refかつ値が#/で始まる文字列の場合、isRefAlias: trueになる', () => {
    const groups = yamlToStructuredNodes('$ref: "#/components/schemas/Pet"\n')
    expect(groups[0].root.children[0].isRefAlias).toBe(true)
  })
})
