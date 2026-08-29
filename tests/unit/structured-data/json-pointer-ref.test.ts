import { describe, expect, it } from 'vitest'
import { resolveRefTarget } from '../../../src/renderer/content/structured-data/tree-viewer'

describe('resolveRefTarget', () => {
  it('同一ファイル内参照（#/で始まる）の場合、#を除いたJSON Pointerパスを返す', () => {
    expect(resolveRefTarget('#/components/schemas/Pet')).toBe('/components/schemas/Pet')
  })

  it('ルート参照（#/のみ）の場合、/を返す', () => {
    expect(resolveRefTarget('#/')).toBe('/')
  })

  it('RFC 6901エスケープを含むパスはそのまま（デコードせず）返す', () => {
    expect(resolveRefTarget('#/a~1b/c~0d')).toBe('/a~1b/c~0d')
  })

  it('別ファイル参照（./other.yaml#/...）の場合はnullを返す', () => {
    expect(resolveRefTarget('./other.yaml#/x')).toBeNull()
  })

  it('外部URL参照（https://...）の場合はnullを返す', () => {
    expect(resolveRefTarget('https://example.com/schema.json')).toBeNull()
  })

  it('#で始まらない、または#/で始まらない文字列はnullを返す', () => {
    expect(resolveRefTarget('#fragment-only')).toBeNull()
    expect(resolveRefTarget('plain-string')).toBeNull()
  })
})
