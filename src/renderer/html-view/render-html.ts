import DOMPurify from 'dompurify'
import GithubSlugger from 'github-slugger'
import type { FileOpenedPayload, Heading } from '@shared/types'
import { renderToc } from '../components/sidebar-toc'
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
 * HTMLファイルをサニタイズしタブへ表示する（011-html-pdf-viewer FR-001, FR-003, FR-004, FR-016）。
 * 既存のMarkdownパイプライン（decodeFileBufferでのテキスト読込）をそのまま延長し、
 * DOMPurify.sanitizeで無害化した結果をinnerHTMLへ挿入するのみで、CSP変更は不要（research.md Decision 3）。
 * 相対パス画像・外部CSSは解決できないことがあるが、エラーにはせずそのまま表示する（FR-003、意図的に何もしない）。
 * `isActive`がtrueの場合のみTOCを描画する（activeTabIdの判定はmain.ts側の責務）。
 */
export function renderHtmlDocumentInto(tab: TabRuntime, payload: FileOpenedPayload, isActive: boolean): void {
  tab.containerEl.innerHTML = ''

  if (payload.isEmptyFile) {
    const emptyEl = document.createElement('div')
    emptyEl.className = 'document-pane__empty-message'
    emptyEl.textContent = '空のファイルです'
    tab.containerEl.appendChild(emptyEl)
    return
  }

  tab.containerEl.innerHTML = DOMPurify.sanitize(payload.rawContent)
  tab.headings = extractHeadingsFromDom(tab.containerEl)
  if (isActive) {
    void renderToc(tab.headings, tab.containerEl)
  }
}
