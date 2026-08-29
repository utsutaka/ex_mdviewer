import DOMPurify from 'dompurify'
import mermaid from 'mermaid'
import type { MermaidBlock } from '@shared/types'
import { showToast } from '../components/toast'
import { parseDocument, type Tokens } from './render'

export type MermaidTheme = 'default' | 'dark'

let currentMermaidTheme: MermaidTheme = 'default'

function configureMermaid(theme: MermaidTheme): void {
  currentMermaidTheme = theme
  mermaid.initialize({
    startOnLoad: false,
    theme,
    // securityLevel: 'strict'によりラベル内の生HTML/スクリプトを無効化する（constitution原則II, V）
    securityLevel: 'strict',
    // false（既定）だとmermaidが構文エラー用のSVG（爆弾アイコン）をDOMへ直接挿入してしまい、
    // render()が例外を投げなくなるため、trueにしてPromise rejectとして扱えるようにする（FR-022）
    suppressErrorRendering: true
  })
}

configureMermaid('default')

let mermaidIdCounter = 0

/** パース済みトークン列から ```mermaid ブロックを検出する（FR-020） */
export function detectMermaidBlocksFromTokens(tokens: Tokens): MermaidBlock[] {
  return tokens
    .filter((token) => token.type === 'fence' && token.info.trim() === 'mermaid')
    .map((token) => ({
      id: `mermaid-${mermaidIdCounter++}`,
      sourceText: token.content,
      renderStatus: 'pending' as const,
      errorMessage: null
    }))
}

/** rawContentから直接検出する簡易版（テスト・単発利用向け） */
export function detectMermaidBlocks(rawContent: string): MermaidBlock[] {
  const { tokens } = parseDocument(rawContent)
  return detectMermaidBlocksFromTokens(tokens)
}

// 複数ブロックがある場合もメインスレッドをブロックしないよう描画キューへ逐次投入する（FR-021, FR-025）
let renderChain: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<void>): Promise<void> {
  const next = renderChain.then(task, task)
  renderChain = next
  return next
}

async function renderSvgInto(id: string, sourceText: string): Promise<string | null> {
  try {
    const { svg } = await mermaid.render(id, sourceText)
    // MermaidはノードラベルをHTML(<span>/<p>)としてforeignObject内に描画する。
    // DOMPurifyはSVGプロファイルでもforeignObjectを既定で除去するためADD_TAGSで許可が必要な上、
    // 既定のHTML_INTEGRATION_POINTSがforeignobjectを含まずSVG名前空間内のHTML子要素を
    // 名前空間チェックで剥ぎ取ってしまうため、明示的にforeignobjectを統合ポイントとして追加する
    return DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true, html: true },
      ADD_TAGS: ['foreignObject'],
      ADD_ATTR: ['requiredExtensions'],
      HTML_INTEGRATION_POINTS: { foreignobject: true }
    })
  } catch {
    return null
  }
}

function createWrapper(id: string, sourceText: string): HTMLDivElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'mermaid-diagram'
  wrapper.dataset.mermaidId = id
  wrapper.dataset.mermaidSource = sourceText
  return wrapper
}

/**
 * 単一ブロックを描画する。構文エラー時は元のコードブロック表示を維持したまま
 * トースト通知のみ行い、他ブロックの描画には影響しない（FR-022, FR-023）。
 */
async function renderOneBlock(pre: HTMLElement, block: MermaidBlock): Promise<void> {
  const svg = await renderSvgInto(block.id, block.sourceText)
  if (svg === null) {
    showToast(
      'Mermaidダイアグラムの構文を解析できませんでした。コードのまま表示します。',
      'error'
    )
    return
  }
  const wrapper = createWrapper(block.id, block.sourceText)
  wrapper.innerHTML = svg
  pre.replaceWith(wrapper)
}

/**
 * 表示中のコンテナ内の```mermaidブロックを検出し、個別に描画キューへ投入する（FR-020, FR-021）。
 * トークン順とDOM内のcode.language-mermaid出現順は一致するため、インデックスで対応付ける。
 */
export function renderMermaidBlocks(containerEl: HTMLElement, tokens: Tokens): void {
  const blocks = detectMermaidBlocksFromTokens(tokens)
  if (blocks.length === 0) {
    return
  }
  const codeEls = Array.from(containerEl.querySelectorAll<HTMLElement>('code.language-mermaid'))

  blocks.forEach((block, index) => {
    const codeEl = codeEls[index]
    if (!codeEl) {
      return
    }
    const pre = (codeEl.closest('pre') ?? codeEl) as HTMLElement
    void enqueue(() => renderOneBlock(pre, block))
  })
}

/**
 * HTML表示中の文書内でpre.mermaid/div.mermaid要素を検出する純粋関数（017-html-mermaid-support FR-001）。
 * CSSクラスセレクタによる検出のため、他クラスの併記（例: class="mermaid theme-dark"）も対象に含み、
 * 大文字小文字はブラウザ標準のクラスセレクタ挙動に従い区別する。
 */
export function detectMermaidElements(
  containerEl: HTMLElement
): { element: HTMLElement; sourceText: string }[] {
  return Array.from(containerEl.querySelectorAll<HTMLElement>('pre.mermaid, div.mermaid')).map(
    (element) => ({ element, sourceText: element.textContent ?? '' })
  )
}

/**
 * detectMermaidElementsの検出結果を既存の描画キューへ投入する（017-html-mermaid-support FR-002〜FR-005・FR-008）。
 * renderOneBlockはpre.replaceWith(wrapper)という汎用的なDOM操作のみを行うため、
 * 検出元がMarkdownのトークンかHTMLのDOM要素かを問わず、Markdown表示向けの既存実装をそのまま再利用できる。
 */
export function renderMermaidBlocksInDom(containerEl: HTMLElement): void {
  for (const { element, sourceText } of detectMermaidElements(containerEl)) {
    const block: MermaidBlock = {
      id: `mermaid-${mermaidIdCounter++}`,
      sourceText,
      renderStatus: 'pending',
      errorMessage: null
    }
    void enqueue(() => renderOneBlock(element, block))
  }
}

/** テーマ変更に連動してmermaid.initializeを再設定し、表示中の全図を再描画する（FR-024） */
export function applyMermaidTheme(theme: MermaidTheme): void {
  if (theme === currentMermaidTheme) {
    return
  }
  configureMermaid(theme)

  const wrappers = Array.from(document.querySelectorAll<HTMLElement>('.mermaid-diagram'))
  for (const wrapper of wrappers) {
    const source = wrapper.dataset.mermaidSource ?? ''
    const id = wrapper.dataset.mermaidId ?? `mermaid-${mermaidIdCounter++}`
    void enqueue(async () => {
      const svg = await renderSvgInto(id, source)
      if (svg !== null) {
        wrapper.innerHTML = svg
      }
    })
  }
}
