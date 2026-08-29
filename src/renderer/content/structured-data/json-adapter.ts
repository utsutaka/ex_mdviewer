import type { StructuredNode, StructuredNodeKind } from '@shared/types'

/**
 * JSON Pointer（RFC 6901）のトークンエスケープ。
 * `~`を`~0`へ、`/`を`~1`へ変換する（この順序を守らないと二重エスケープになる）。
 */
function escapeJsonPointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}

function resolveKind(value: unknown): StructuredNodeKind {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  switch (typeof value) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'object'
  }
}

/**
 * OpenAPI/Swagger等で使われる同一ファイル内`$ref`（JSON Pointer形式）を検出する。
 * 別ファイル参照・外部URL参照は対象外（010-json-yaml-xml-viewer FR-018）。
 */
function isSameFileRef(key: string | null, kind: StructuredNodeKind, value: unknown): boolean {
  return key === '$ref' && kind === 'string' && typeof value === 'string' && value.startsWith('#/')
}

/**
 * `JSON.parse()`結果を`StructuredNode`ツリーへ変換する（010-json-yaml-xml-viewer research.md Decision 2, 7）。
 * ルート呼び出しは引数省略でよい（key: null, pointer: ''）。
 */
export function toStructuredNodeFromJson(
  value: unknown,
  key: string | null = null,
  pointer = ''
): StructuredNode {
  const kind = resolveKind(value)

  let children: StructuredNode[] = []
  if (kind === 'object') {
    children = Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) =>
      toStructuredNodeFromJson(childValue, childKey, `${pointer}/${escapeJsonPointerToken(childKey)}`)
    )
  } else if (kind === 'array') {
    children = (value as unknown[]).map((childValue, index) =>
      toStructuredNodeFromJson(childValue, null, `${pointer}/${index}`)
    )
  }

  return {
    kind,
    key,
    value: kind === 'string' || kind === 'number' || kind === 'boolean' ? (value as string | number | boolean) : null,
    children,
    anchorLabel: null,
    anchorRefPointer: null,
    isRefAlias: isSameFileRef(key, kind, value),
    jsonPointer: pointer
  }
}
