import type { StructuredNode, StructuredNodeKind } from '@shared/types'

/**
 * StructuredNodeツリーをDOMへ描画するツリービューア本体
 * （010-json-yaml-xml-viewer research.md Decision 5）。
 * JSON/YAML/XML共通で使用し、折り畳み・シンタックスハイライト・インデントガイド・
 * 要素数表示・`$ref`/アンカー注記ジャンプを担う。
 *
 * 大容量ファイル（数万ノード規模）で以下2つの遅延が実機検証で判明したため、
 * 両方に対応する設計にしている（010-json-yaml-xml-viewer Convergence T030）:
 * 1. 初期表示: 折り畳んで見えない部分まで開いた瞬間に全構築していたため遅かった
 *    → 折り畳まれたノードの子要素DOM構築を展開時まで遅延する
 * 2. 巨大配列/オブジェクトの展開: 数万件を一度に構築すると数十秒かかる
 *    → 1回の展開では先頭バッチ（PARTIAL_EXPAND_BATCH_SIZE件）のみ構築し、
 *      「さらにN件を表示」ボタンで追加読み込みする部分展開方式にする
 */

const CHUNK_SIZE = 500
const PARTIAL_EXPAND_BATCH_SIZE = 500

interface RenderCounter {
  count: number
}

/**
 * `$ref`/アンカージャンプのために「対象ノードの子要素をすべて構築する」関数を、
 * 対応するDOM要素に紐付けて保持する。部分展開中のノードでは、残りのバッチを
 * 順次構築することで最終的に全件構築する。
 */
const ensureAllChildrenBuiltMap = new WeakMap<HTMLElement, () => Promise<void>>()

function countByKind(children: StructuredNode[]): { attrs: number; rest: number } {
  let attrs = 0
  let rest = 0
  for (const child of children) {
    if (child.kind === 'attribute') {
      attrs += 1
    } else {
      rest += 1
    }
  }
  return { attrs, rest }
}

/**
 * 折り畳み時に表示する要素数ラベルを算出する（FR-007）。
 * XML要素（`kind: 'element'`）は子要素数・属性数を区別して表示し、
 * object/arrayはキー数・項目数として表示する。子を持たない場合はnull（FR-008）。
 */
function buildCountLabel(node: StructuredNode): string | null {
  if (node.children.length === 0) {
    return null
  }
  if (node.kind === 'element') {
    const { attrs, rest } = countByKind(node.children)
    return `${rest} children, ${attrs} attrs`
  }
  if (node.kind === 'array') {
    return `${node.children.length} items`
  }
  if (node.kind === 'object') {
    return `${node.children.length} keys`
  }
  return null
}

function scalarClass(kind: StructuredNodeKind): string {
  switch (kind) {
    case 'string':
      return 'sdv-string'
    case 'number':
      return 'sdv-number'
    case 'boolean':
      return 'sdv-boolean'
    case 'null':
      return 'sdv-null'
    case 'object':
    case 'array':
    case 'element':
      // 子を持たない（空の）object/array/element。値としてはnullだが、
      // nullリテラルとは意味が異なるため別クラスで薄く表示する
      return 'sdv-empty'
    default:
      return ''
  }
}

/**
 * 子を持たないノードの値表示テキストを算出する。`object`/`array`/`element`は
 * 子を持たない場合でも`value`フィールドは常にnull（data-model.md）であり、
 * `String(node.value)`をそのまま使うとnullリテラルと区別が付かなくなるため、
 * 種別ごとに「空である」ことを示す専用表記へ変換する。
 */
function formatScalarValue(node: StructuredNode): string {
  if (node.kind === 'object') {
    return '{}'
  }
  if (node.kind === 'array') {
    return '[]'
  }
  if (node.kind === 'element') {
    return '(empty)'
  }
  if (node.kind === 'string') {
    return `"${String(node.value)}"`
  }
  if (node.kind === 'null') {
    return 'null'
  }
  return String(node.value)
}

/**
 * `node.children`の`[startIndex, endIndex)`範囲を構築してDocumentFragmentへ詰める。
 * 500ノードごとにイベントループへ処理を委譲し、大容量ファイルでもメインスレッドを
 * 長時間占有しない（既存sidebar-toc.tsのbuildListAsyncと同パターン、research.md Decision 6）。
 */
async function buildChildrenBatch(
  node: StructuredNode,
  depth: number,
  counter: RenderCounter,
  startIndex: number,
  endIndex: number
): Promise<DocumentFragment> {
  const fragment = document.createDocumentFragment()
  for (let i = startIndex; i < endIndex; i += 1) {
    fragment.appendChild(await buildNodeElement(node.children[i], depth + 1, counter))
    counter.count += 1
    if (counter.count % CHUNK_SIZE === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  return fragment
}

/**
 * ノード1つ分のDOMを構築する。
 *
 * ルート直下（depth === 1）のノードは折り畳んだ状態で初期表示し（FR-009）、
 * その子要素（depth 2以降）のDOM構築は初回展開まで遅延する。展開状態のノード
 * （depth 0、depth 1以外）は先頭バッチのみ即座に構築する。
 *
 * 子要素数がPARTIAL_EXPAND_BATCH_SIZEを超える場合、展開時は先頭バッチのみ構築し、
 * 「さらにN件を表示」ボタンで残りを追加構築する（Convergence T030）。
 */
async function buildNodeElement(
  node: StructuredNode,
  depth: number,
  counter: RenderCounter
): Promise<HTMLDivElement> {
  const nodeEl = document.createElement('div')
  nodeEl.className = 'sdv-node'
  if (node.jsonPointer !== null) {
    nodeEl.dataset.jsonPointer = node.jsonPointer
  }

  const row = document.createElement('div')
  row.className = 'sdv-row'
  nodeEl.appendChild(row)

  const hasChildren = node.children.length > 0
  const initiallyCollapsed = depth === 1 && hasChildren

  let childrenEl: HTMLDivElement | null = null
  let renderedCount = 0
  let loadMoreEl: HTMLButtonElement | null = null

  const updateLoadMoreButton = (): void => {
    if (!childrenEl) {
      return
    }
    const remaining = node.children.length - renderedCount
    if (remaining <= 0) {
      loadMoreEl?.remove()
      loadMoreEl = null
      return
    }
    if (!loadMoreEl) {
      loadMoreEl = document.createElement('button')
      loadMoreEl.type = 'button'
      loadMoreEl.className = 'sdv-load-more'
      loadMoreEl.addEventListener('click', () => {
        void renderNextBatch()
      })
      childrenEl.appendChild(loadMoreEl)
    }
    const nextBatchSize = Math.min(remaining, PARTIAL_EXPAND_BATCH_SIZE)
    loadMoreEl.textContent = `さらに${nextBatchSize}件を表示（残り${remaining}件）`
  }

  const renderNextBatch = async (): Promise<void> => {
    if (!childrenEl) {
      return
    }
    const upperBound = Math.min(renderedCount + PARTIAL_EXPAND_BATCH_SIZE, node.children.length)
    const fragment = await buildChildrenBatch(node, depth, counter, renderedCount, upperBound)
    renderedCount = upperBound
    if (loadMoreEl) {
      childrenEl.insertBefore(fragment, loadMoreEl)
    } else {
      childrenEl.appendChild(fragment)
    }
    updateLoadMoreButton()
  }

  let childrenInitialized = false
  const ensureChildrenInitialized = async (): Promise<void> => {
    if (childrenInitialized) {
      return
    }
    childrenInitialized = true
    childrenEl = document.createElement('div')
    childrenEl.className = 'sdv-children'
    nodeEl.appendChild(childrenEl)
    await renderNextBatch()
  }

  const ensureAllChildrenBuilt = async (): Promise<void> => {
    await ensureChildrenInitialized()
    while (renderedCount < node.children.length) {
      await renderNextBatch()
    }
  }

  if (hasChildren) {
    ensureAllChildrenBuiltMap.set(nodeEl, ensureAllChildrenBuilt)

    const toggle = document.createElement('span')
    toggle.className = 'sdv-toggle'
    toggle.addEventListener('click', () => {
      void ensureChildrenInitialized().then(() => {
        nodeEl.classList.toggle('collapsed')
      })
    })
    row.appendChild(toggle)
  }

  if (node.key !== null) {
    const keyEl = document.createElement('span')
    keyEl.className = 'sdv-key'
    keyEl.textContent = node.kind === 'attribute' ? `@${node.key} ` : `"${node.key}": `
    row.appendChild(keyEl)
  }

  if (!hasChildren) {
    const valueEl = document.createElement('span')
    valueEl.className = scalarClass(node.kind)
    valueEl.textContent = formatScalarValue(node)
    if (node.isRefAlias) {
      valueEl.classList.add('sdv-ref-link')
      valueEl.dataset.refTarget = String(node.value)
    }
    row.appendChild(valueEl)
  }

  // アンカー参照の視覚的注記（FR-014）は、展開先がスカラーであってもオブジェクト/配列
  // であっても表示する必要があるため、hasChildrenの真偽によらず判定する。
  // 定義元のjsonPointerが判明している場合はクリックでジャンプできるようにする（FR-020）
  if (node.anchorLabel) {
    const anchorEl = document.createElement('span')
    anchorEl.className = 'sdv-anchor-label'
    anchorEl.textContent = `(&${node.anchorLabel})`
    if (node.anchorRefPointer !== null) {
      anchorEl.classList.add('sdv-anchor-link')
      anchorEl.dataset.anchorTarget = node.anchorRefPointer
      anchorEl.title = `YAMLアンカー &${node.anchorLabel} の定義元へジャンプ`
    }
    row.appendChild(anchorEl)
  }

  const countLabel = buildCountLabel(node)
  if (countLabel) {
    const countEl = document.createElement('span')
    countEl.className = 'sdv-count'
    countEl.textContent = countLabel
    row.appendChild(countEl)
  }

  if (hasChildren) {
    if (initiallyCollapsed) {
      nodeEl.classList.add('collapsed')
      // 子要素の構築は展開まで遅延する（Convergence T030、大容量ファイルの初期表示高速化）
    } else {
      await ensureChildrenInitialized()
    }
  }

  return nodeEl
}

/**
 * `$ref`の値から、同一ファイル内参照（`#/`で始まる）のJSON Pointerパスを算出する。
 * 別ファイル参照・外部URL参照はnullを返す（010-json-yaml-xml-viewer FR-017, FR-018）。
 */
export function resolveRefTarget(refValue: string): string | null {
  if (!refValue.startsWith('#/')) {
    return null
  }
  return refValue.slice(1)
}

/** jsonPointerパスをセグメントへ分解する（先頭の空要素は除く。ルート自身は`[]`） */
function splitPointer(pointer: string): string[] {
  if (pointer === '') {
    return []
  }
  return pointer.slice(1).split('/')
}

/**
 * `ownerRoot`（1ドキュメント分のルート`.sdv-node`）を起点に、`pointer`が指すノードまで
 * 各階層で必要な箇所だけ`ensureAllChildrenBuilt()`を呼びながら辿り、対応するDOM要素を返す
 * （未展開・部分展開でDOM未構築のノードもジャンプ対象にできる、FR-017, FR-020）。
 */
async function resolveNodeElement(ownerRoot: HTMLElement, pointer: string): Promise<HTMLElement | null> {
  const segments = splitPointer(pointer)
  let currentEl: HTMLElement = ownerRoot
  let currentPointer = ownerRoot.dataset.jsonPointer ?? ''

  for (const segment of segments) {
    const ensureFn = ensureAllChildrenBuiltMap.get(currentEl)
    if (ensureFn) {
      await ensureFn()
    }
    const childrenEl = currentEl.querySelector<HTMLElement>(':scope > .sdv-children')
    if (!childrenEl) {
      return null
    }
    currentPointer = `${currentPointer}/${segment}`
    const nextEl = Array.from(childrenEl.children).find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.dataset.jsonPointer === currentPointer
    )
    if (!nextEl) {
      return null
    }
    currentEl = nextEl
  }
  return currentEl
}

/**
 * クリックされた要素が属する1ドキュメント分のルート`.sdv-node`（`containerEl`の直接の子）を
 * 特定する。YAML複数ドキュメント時、`$ref`/アンカーのジャンプ先探索を同一ドキュメント内に
 * 限定するために使用する（FR-017の「同一ドキュメント内に限定」）。
 */
function findOwnerRoot(el: HTMLElement, containerEl: HTMLElement): HTMLElement | null {
  let current = el.closest<HTMLElement>('.sdv-node')
  while (current && current.parentElement !== containerEl) {
    const parentNode = current.parentElement?.closest<HTMLElement>('.sdv-node') ?? null
    if (!parentNode) {
      return null
    }
    current = parentNode
  }
  return current
}

/** targetNodeへ至るまでの祖先ノードの折り畳みをすべて解除する（FR-017, FR-020） */
function expandAncestors(targetNode: HTMLElement): void {
  let current: HTMLElement | null = targetNode.parentElement
  while (current) {
    const ancestorNode = current.closest<HTMLElement>('.sdv-node')
    if (!ancestorNode) {
      break
    }
    ancestorNode.classList.remove('collapsed')
    current = ancestorNode.parentElement
  }
}

function highlightNode(el: HTMLElement): void {
  el.classList.add('sdv-highlight')
  setTimeout(() => {
    el.classList.remove('sdv-highlight')
  }, 1600)
}

/** 指定したjsonPointerのノードへ（必要なら遅延構築しながら）スクロール・自動展開・一時ハイライトを行う */
async function jumpToPointer(ownerRoot: HTMLElement, pointer: string | null): Promise<void> {
  if (pointer === null) {
    return
  }
  const targetNode = await resolveNodeElement(ownerRoot, pointer)
  if (!targetNode) {
    return
  }
  expandAncestors(targetNode)
  // 祖先だけでなくジャンプ先ノード自体も展開し、中身がすぐ見える状態にする
  const ensureFn = ensureAllChildrenBuiltMap.get(targetNode)
  if (ensureFn) {
    await ensureFn()
  }
  targetNode.classList.remove('collapsed')
  targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
  highlightNode(targetNode)
}

/**
 * `containerEl`内の`$ref`・YAMLアンカー注記のクリック可能要素へのクリックイベントを
 * 1回だけ登録する（イベント委譲、`renderStructuredTree()`が複数回呼ばれても重複登録しない）。
 */
function initRefJumpHandler(containerEl: HTMLElement): void {
  if (containerEl.dataset.refJumpInitialized === 'true') {
    return
  }
  containerEl.dataset.refJumpInitialized = 'true'

  containerEl.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    const refLink = target.closest<HTMLElement>('.sdv-ref-link')
    if (refLink) {
      const ownerRoot = findOwnerRoot(refLink, containerEl)
      if (!ownerRoot) {
        return
      }
      const refValue = refLink.dataset.refTarget
      void jumpToPointer(ownerRoot, refValue ? resolveRefTarget(refValue) : null)
      return
    }

    const anchorLink = target.closest<HTMLElement>('.sdv-anchor-link')
    if (anchorLink) {
      const ownerRoot = findOwnerRoot(anchorLink, containerEl)
      if (!ownerRoot) {
        return
      }
      void jumpToPointer(ownerRoot, anchorLink.dataset.anchorTarget ?? null)
    }
  })
}

/** StructuredNodeツリーを`containerEl`へ描画する */
export async function renderStructuredTree(root: StructuredNode, containerEl: HTMLElement): Promise<void> {
  initRefJumpHandler(containerEl)
  const counter: RenderCounter = { count: 0 }
  const rootEl = await buildNodeElement(root, 0, counter)
  containerEl.appendChild(rootEl)
}
