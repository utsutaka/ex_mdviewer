// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { toStructuredNodeFromXml } from '../../../src/renderer/structured-data/xml-adapter'

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

describe('toStructuredNodeFromXml', () => {
  it('要素・属性・テキストノードをそれぞれ対応するkindへ変換する', () => {
    const doc = parseXml('<root a="1"><child>text</child></root>')
    const node = toStructuredNodeFromXml(doc.documentElement)
    expect(node.kind).toBe('element')
    expect(node.key).toBe('root')
    const attr = node.children.find((c) => c.kind === 'attribute')
    expect(attr?.key).toBe('a')
    expect(attr?.value).toBe('1')
    const child = node.children.find((c) => c.kind === 'element')
    expect(child?.key).toBe('child')
    const text = child?.children.find((c) => c.kind === 'text')
    expect(text?.value).toBe('text')
  })

  it('コメント・CDATA・処理命令・DOCTYPEをツリーから除外する', () => {
    const doc = parseXml(
      '<root><!-- comment --><![CDATA[cdata]]><a>1</a></root>'
    )
    const node = toStructuredNodeFromXml(doc.documentElement)
    // コメント・CDATAは除外され、<a>要素のみがchildrenに含まれる
    expect(node.children).toHaveLength(1)
    expect(node.children[0].kind).toBe('element')
    expect(node.children[0].key).toBe('a')
  })

  it('子要素も属性も持たない空要素はchildren: []になる', () => {
    const doc = parseXml('<root><empty></empty></root>')
    const node = toStructuredNodeFromXml(doc.documentElement)
    const empty = node.children.find((c) => c.key === 'empty')
    expect(empty?.children).toEqual([])
  })

  it('名前空間prefix付きタグ名をそのまま保持する', () => {
    const doc = parseXml('<soap:Envelope xmlns:soap="http://example.com"><soap:Body/></soap:Envelope>')
    const node = toStructuredNodeFromXml(doc.documentElement)
    expect(node.key).toBe('soap:Envelope')
  })
})
