import GithubSlugger from 'github-slugger'
import type { FileOpenedPayload, Heading, Theme } from '@shared/types'
import { renderMermaidBlocksInDom } from '../markdown/mermaid'
import type { TabRuntime } from '../main'

/**
 * markdown/toc.tsのslugify方針（GitHub互換スラッグ、空スラッグ時のフォールバック）を踏襲する。
 * HTML表示ではmarkdown-it-anchorを経由しないため、DOM要素へ直接IDを付与する。
 */
function slugify(slugger: GithubSlugger, text: string): string {
  return slugger.slug(text) || slugger.slug('heading')
}

/**
 * 挿入済みDOMから見出し（h1〜h6）を抽出し、階層化したHeading[]へ変換する（011-html-pdf-viewer FR-002）。
 * 既存`id`属性を持つ見出しはそれをanchorIdとして使い、持たない見出しにはgithub-sluggerで
 * IDを生成し要素にも付与する（TOCクリックジャンプが`id`セレクタで要素を検索するため必須）。
 * 036-iframe-html-view: 呼び出し元がiframe.contentDocument配下の要素を渡す形に変わったが、
 * 本関数自体はDOM要素を受け取るだけの純粋な処理のため変更不要。
 */
export function extractHeadingsFromDom(containerEl: HTMLElement): Heading[] {
  const slugger = new GithubSlugger()
  const root: Heading[] = []
  const stack: Heading[] = []

  const headingEls = containerEl.querySelectorAll('h1, h2, h3, h4, h5, h6')
  for (const el of Array.from(headingEls)) {
    const level = Number(el.tagName.slice(1))
    const text = el.textContent ?? ''
    if (!el.id) {
      el.id = slugify(slugger, text)
    }

    const heading: Heading = {
      level,
      text,
      anchorId: el.id,
      children: []
    }

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }
    if (stack.length === 0) {
      root.push(heading)
    } else {
      stack[stack.length - 1].children.push(heading)
    }
    stack.push(heading)
  }

  return root
}

/**
 * Windowsファイルパスをfile:// URLへ変換する（`node:path`がrenderer環境では使えないための自前実装）。
 * ドライブレター（例: "E:"）はそのまま維持し、それ以外の各パスセグメントを個別にURIエンコードする
 * ことで、日本語・スペース・`#`を含むパスでも正しいURLになる（`render-pdf.ts`の
 * `filePathToFileUrl()`と同一ロジック、036-iframe-html-view research.md Decision 1）。
 */
function filePathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  const encoded = segments
    .map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/')
  return `file:///${encoded}`
}

const THEME_FALLBACK_STYLE_ID = 'mdviewer-html-theme-fallback'

/**
 * HTMLファイルが`pre`/`code`要素の配色を指定していない場合のテーマ連動フォールバックCSSを生成する
 * （015-fix-html-codeblock-bg相当の規則、036-iframe-html-view research.md Decision 5）。
 * `@layer`でラップすることで、HTMLファイル自身の`<style>`（`@layer`を伴わない通常の詳細度）に対し
 * 常に優先度が低くなり、HTML側の指定があれば常にそちらが優先される（CSS Cascade Layersの仕様）。
 * 色コードは`src/renderer/styles/base.css`の`:root.theme-light`/`:root.theme-dark`が定義する
 * `--panel-bg`/`--fg-color`の値を複製したもの。CSS変数はdocument境界を越えて継承されないため、
 * iframe内document向けには直接色コードを埋め込む必要がある（base.cssの値を変更した場合はこちらも
 * 追従が必要）。
 */
export function buildThemeFallbackCss(theme: Theme): string {
  const { panelBg, fg } = theme === 'dark' ? { panelBg: '#252526', fg: '#e0e0e0' } : { panelBg: '#f5f5f5', fg: '#1a1a1a' }
  return `@layer html-view-fallback {
  pre {
    background: ${panelBg};
    color: ${fg};
  }
  code {
    background: ${panelBg};
    color: ${fg};
  }
  pre code {
    background: none;
  }
}`
}

/**
 * iframe内documentへテーマ連動フォールバックの`<style>`要素を注入する（初回表示・テーマ変更時の
 * 両方から呼ばれる）。既存の注入済み`<style>`要素があれば内容を更新するだけにとどめ、
 * 重複挿入しない（`THEME_FALLBACK_STYLE_ID`で識別）。
 */
export function injectThemeFallbackStyle(doc: Document, theme: Theme): void {
  let styleEl = doc.getElementById(THEME_FALLBACK_STYLE_ID) as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = doc.createElement('style')
    styleEl.id = THEME_FALLBACK_STYLE_ID
    doc.head.appendChild(styleEl)
  }
  styleEl.textContent = buildThemeFallbackCss(theme)
}

/** mdviewer本体（親document）の現在のテーマを取得する（`initThemeAndWidthListeners`が付与するクラスを参照） */
function getCurrentTheme(): Theme {
  return document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light'
}

/**
 * HTMLファイルを`<iframe src="file://...">`で表示する（011-html-pdf-viewer FR-001, FR-003, FR-004,
 * FR-016、036-iframe-html-view）。
 *
 * 旧実装（DOMPurify.sanitize + DOMParser + ノード移植）を廃止し、iframeによる
 * ブラウジングコンテキスト分離へ切り替える（research.md Decision 1）。これにより:
 * - HTML自身の<style>・<link rel="stylesheet">による配色がmdviewer本体のCSSと競合せず
 *   反映される（014-html-style-support・027-fix-html-style-scope由来の副作用が構造的に解消）
 * - 外部CSSファイルの相対パス解決ができる（011 FR-003の制限解消、base URLが自然に
 *   ファイル自身のディレクトリになるため）
 * - <script>タグは`sandbox="allow-same-origin"`（`allow-scripts`を付与しない）により実行されない
 *   （DOMPurifyによる無害化が不要になる）
 * - position: fixed等によるUI乗っ取りはiframeの構造上封じ込められる（016-fix-html-ui-hijackの
 *   contain: paintワークアラウンドが不要になる）
 *
 * 見出し抽出（TOC通知）はiframeの`load`完了後に非同期で行う（research.md Decision 4）。
 */
export function renderHtmlDocumentInto(
  tab: TabRuntime,
  payload: FileOpenedPayload,
  notifyHeadingListUpdated: (tab: TabRuntime, interactive: boolean) => void
): void {
  tab.containerEl.innerHTML = ''

  if (payload.isEmptyFile) {
    const emptyEl = document.createElement('div')
    emptyEl.className = 'document-pane__empty-message'
    emptyEl.textContent = '空のファイルです'
    tab.containerEl.appendChild(emptyEl)
    return
  }

  const iframe = document.createElement('iframe')
  iframe.className = 'document-pane__html-frame'
  // allow-scriptsを付与しないため<script>は実行されない。allow-same-originにより
  // iframe.contentDocumentへ親documentからアクセスできる（見出し抽出・mermaid描画に必須）
  iframe.sandbox.add('allow-same-origin')
  iframe.addEventListener('load', () => {
    const doc = iframe.contentDocument
    if (!doc || !doc.body) {
      return
    }
    tab.headings = extractHeadingsFromDom(doc.body)
    // HTML内のpre.mermaid/div.mermaidブロックを図として描画する（017-html-mermaid-support FR-001〜FR-002）
    renderMermaidBlocksInDom(doc.body)
    // pre/code配色の未指定時テーマ連動フォールバック（015-fix-html-codeblock-bg踏襲、FR-009）
    injectThemeFallbackStyle(doc, getCurrentTheme())
    notifyHeadingListUpdated(tab, true)
  })
  iframe.src = filePathToFileUrl(payload.filePath)
  tab.containerEl.appendChild(iframe)
}
