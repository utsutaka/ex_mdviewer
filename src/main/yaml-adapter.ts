import { isAlias, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml'
import type { Document, Node } from 'yaml'
import type { StructuredNode, StructuredNodeKind, YamlDocumentGroup } from '@shared/types'

/**
 * JSON Pointer（RFC 6901）のトークンエスケープ。
 * `~`を`~0`へ、`/`を`~1`へ変換する（この順序を守らないと二重エスケープになる）。
 */
function escapeJsonPointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}

function resolveScalarKind(value: unknown): StructuredNodeKind {
  if (value === null || value === undefined) {
    return 'null'
  }
  switch (typeof value) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'string'
  }
}

function isSameFileRef(key: string | null, kind: StructuredNodeKind, value: unknown): boolean {
  return key === '$ref' && kind === 'string' && typeof value === 'string' && value.startsWith('#/')
}

/**
 * ASTを1回先読みし、アンカー名→定義元ノードのjsonPointerのマップを構築する。
 * `Alias`ノードのクリック時にアンカー定義元へジャンプする機能（クリック時に
 * うつたかさんからのフィードバックで追加）に使用する。`Alias`自体は辿らない
 * （YAML文法上、エイリアス内に別のエイリアス定義は現れない）。
 */
function buildAnchorPointerMap(node: Node | null | undefined, pointer: string, map: Map<string, string>): void {
  if (isAlias(node)) {
    return
  }
  if ((isMap(node) || isSeq(node) || isScalar(node)) && node.anchor) {
    map.set(node.anchor, pointer)
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      const childKey = String(isScalar(pair.key) ? pair.key.value : pair.key)
      buildAnchorPointerMap(
        pair.value as Node | null | undefined,
        `${pointer}/${escapeJsonPointerToken(childKey)}`,
        map
      )
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, index) => {
      buildAnchorPointerMap(item as Node | null | undefined, `${pointer}/${index}`, map)
    })
  }
}

/**
 * `yaml`パッケージのAST（`Document#contents`）を再帰的に辿り`StructuredNode`へ変換する。
 * `Alias`ノードは`resolve()`で参照先を解決し、値をそのまま展開した上で
 * 参照元アンカー名を`anchorLabel`へ、定義元ノードへのjsonPointerを`anchorRefPointer`へ
 * 設定する（010-json-yaml-xml-viewer FR-014, research.md Decision 1）。
 */
function convertNode(
  node: Node | null | undefined,
  doc: Document,
  key: string | null,
  pointer: string,
  anchorPointerMap: Map<string, string>,
  anchorLabelOverride: string | null = null
): StructuredNode {
  if (isAlias(node)) {
    const resolved = node.resolve(doc)
    return convertNode(resolved as Node | null | undefined, doc, key, pointer, anchorPointerMap, node.source)
  }

  const anchorRefPointer = anchorLabelOverride ? (anchorPointerMap.get(anchorLabelOverride) ?? null) : null

  if (isMap(node)) {
    const children = node.items.map((pair) => {
      const childKey = String(isScalar(pair.key) ? pair.key.value : pair.key)
      return convertNode(
        pair.value as Node | null | undefined,
        doc,
        childKey,
        `${pointer}/${escapeJsonPointerToken(childKey)}`,
        anchorPointerMap
      )
    })
    return {
      kind: 'object',
      key,
      value: null,
      children,
      anchorLabel: anchorLabelOverride,
      anchorRefPointer,
      isRefAlias: false,
      jsonPointer: pointer
    }
  }

  if (isSeq(node)) {
    const children = node.items.map((item, index) =>
      convertNode(item as Node | null | undefined, doc, null, `${pointer}/${index}`, anchorPointerMap)
    )
    return {
      kind: 'array',
      key,
      value: null,
      children,
      anchorLabel: anchorLabelOverride,
      anchorRefPointer,
      isRefAlias: false,
      jsonPointer: pointer
    }
  }

  const rawValue = isScalar(node) ? node.value : null
  const kind = resolveScalarKind(rawValue)
  const value = kind === 'null' ? null : (rawValue as string | number | boolean)

  return {
    kind,
    key,
    value,
    children: [],
    anchorLabel: anchorLabelOverride,
    anchorRefPointer,
    isRefAlias: isSameFileRef(key, kind, value),
    jsonPointer: pointer
  }
}

/**
 * YAML文字列を`YamlDocumentGroup[]`へ変換する（010-json-yaml-xml-viewer FR-002, FR-014, FR-015）。
 * `---`区切りの複数ドキュメントは「Document N」ラベル付きで分割する。
 * 構文エラーがある場合は例外をthrowする（呼び出し元でFR-010のフォールバックへ委ねる）。
 */
export function yamlToStructuredNodes(rawContent: string): YamlDocumentGroup[] {
  const docs = parseAllDocuments(rawContent)

  for (const doc of docs) {
    if (doc.errors.length > 0) {
      throw doc.errors[0]
    }
  }

  return docs.map((doc, index) => {
    const anchorPointerMap = new Map<string, string>()
    buildAnchorPointerMap(doc.contents, '', anchorPointerMap)
    return {
      label: `Document ${index + 1}`,
      root: convertNode(doc.contents, doc, null, '', anchorPointerMap)
    }
  })
}
