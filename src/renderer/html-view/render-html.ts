import DOMPurify from 'dompurify'
import GithubSlugger from 'github-slugger'
import type { FileOpenedPayload, Heading } from '@shared/types'
import { renderToc } from '../components/sidebar-toc'
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
 * <style>要素の中身をCSS `@scope()`でラップし、セレクタのマッチ範囲をそのタブの
 * containerEl配下に限定する（027-fix-html-style-scope FR-001、research.md Decision 1・4）。
 * <style>要素はDOM上の位置に関係なくdocument全体のCSSOMに参加するため、ラップしない場合は
 * 汎用的なタグ名セレクタ等が他タブのDOM要素にも意図せず適用されてしまう。
 * containerElには007-fix-body-link-jumpで付与済みのdata-tab-id属性（tab.tabIdと同値）があり、
 * それをスコープ境界に使うことでタブ単位の隔離を実現する。
 */
export function scopeStyleContent(css: string, tabId: string): string {
  return `@scope([data-tab-id=${JSON.stringify(tabId)}]) {\n${css}\n}`
}

/**
 * HTMLファイルをサニタイズしタブへ表示する（011-html-pdf-viewer FR-001, FR-003, FR-004, FR-016）。
 * 既存のMarkdownパイプライン（decodeFileBufferでのテキスト読込）をそのまま延長し、
 * DOMPurify.sanitizeで無害化した結果をDOMParserでパースしてから挿入する（CSP変更は不要、research.md Decision 3）。
 * 相対パス画像・外部CSSは解決できないことがあるが、エラーにはせずそのまま表示する（FR-003、意図的に何もしない）。
 * WHOLE_DOCUMENT: trueにより<style>ブロックを保持する（014-html-style-support FR-001、research.md Decision 1）。
 * `<body>`要素はタグごとcontainerElへ移植する（`innerHTML`代入では<body>タグ自体がDOM解析時に
 * 消失し、`body`セレクタや`<body>`のstyle属性による指定が反映できなくなるため。
 * 027-fix-html-style-scope FR-002、research.md Decision 10）。これにより<title>要素は
 * doc.head側に留まりcontainerElへは移さないため、従来の除去処理（`:scope > title`）は不要になった。
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

  const sanitized = DOMPurify.sanitize(payload.rawContent, { WHOLE_DOCUMENT: true })
  const parsedDoc = new DOMParser().parseFromString(sanitized, 'text/html')

  // <head>内の<style>要素は<body>の移植だけでは持ち込まれないため、個別にcontainerElへ移す
  parsedDoc.head.querySelectorAll('style').forEach((styleEl) => {
    tab.containerEl.appendChild(document.adoptNode(styleEl))
  })
  // <body>要素をタグごと移植し、bodyセレクタ・<body>のstyle属性による指定を保持する
  tab.containerEl.appendChild(document.adoptNode(parsedDoc.body))

  tab.containerEl.querySelectorAll('style').forEach((styleEl) => {
    styleEl.textContent = scopeStyleContent(styleEl.textContent ?? '', tab.tabId)
  })
  tab.headings = extractHeadingsFromDom(tab.containerEl)
  // HTML内のpre.mermaid/div.mermaidブロックを図として描画する（017-html-mermaid-support FR-001〜FR-002）
  renderMermaidBlocksInDom(tab.containerEl)
  if (isActive) {
    void renderToc(tab.headings, tab.containerEl)
  }
}
