import type { StructuredNode } from '@shared/types'

const ELEMENT_NODE = 1
const TEXT_NODE = 3

/**
 * XML子ノード1つを`StructuredNode`へ変換する。要素・テキストノードのみ対象とし、
 * コメント・CDATA・処理命令・DOCTYPE宣言は除外する（010-json-yaml-xml-viewer FR-003）。
 * インデント整形由来の空白のみのテキストノードも実用上ノイズになるため除外する。
 */
function convertChildNode(node: Node): StructuredNode | null {
  if (node.nodeType === ELEMENT_NODE) {
    return toStructuredNodeFromXml(node as Element)
  }
  if (node.nodeType === TEXT_NODE) {
    const text = node.textContent ?? ''
    if (text.trim() === '') {
      return null
    }
    return {
      kind: 'text',
      key: null,
      value: text,
      children: [],
      anchorLabel: null,
      anchorRefPointer: null,
      isRefAlias: false,
      jsonPointer: null
    }
  }
  return null
}

/**
 * `DOMParser`でパースしたXML要素を`StructuredNode`ツリーへ変換する
 * （010-json-yaml-xml-viewer research.md Decision 3）。属性ノードを先頭にまとめ、
 * 続けて子要素・テキストノードを出現順に格納する（data-model.md `children`定義）。
 * XMLには`$ref`・アンカーの慣習が存在しないため`isRefAlias`/`anchorLabel`は常に既定値、
 * `jsonPointer`も対象外のため常に`null`（spec.md Assumptions）。
 */
export function toStructuredNodeFromXml(el: Element): StructuredNode {
  const attributeNodes: StructuredNode[] = Array.from(el.attributes).map((attr) => ({
    kind: 'attribute',
    key: attr.name,
    value: attr.value,
    children: [],
    anchorLabel: null,
    anchorRefPointer: null,
    isRefAlias: false,
    jsonPointer: null
  }))

  const childNodes: StructuredNode[] = Array.from(el.childNodes)
    .map(convertChildNode)
    .filter((node): node is StructuredNode => node !== null)

  return {
    kind: 'element',
    key: el.tagName,
    value: null,
    children: [...attributeNodes, ...childNodes],
    anchorLabel: null,
    anchorRefPointer: null,
    isRefAlias: false,
    jsonPointer: null
  }
}
