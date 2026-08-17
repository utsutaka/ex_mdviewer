import GithubSlugger from 'github-slugger'
import anchor from 'markdown-it-anchor'
import type { Heading } from '@shared/types'
import { md, parseDocument, type Tokens } from './render'

/**
 * 見出しへのアンカーID付与（表示用HTMLへも反映される、md.render()と同一インスタンスを共有）。
 *
 * markdown-it-toc-done-rightは`[[toc]]`等のプレースホルダを本文中に含む場合のみTOCを
 * 生成する設計であり、常設サイドバーTOC（本文中のマーカーに依存しない）の用途には
 * 適合しないため採用しない（research.md Decision 2からの変更）。
 * anchorプラグインでID付与のみ行い、木構造の組み立ては本ファイルで自前実装する。
 */

/**
 * GitHub互換のスラッグ生成器。GitHubが実際に使用しているアルゴリズムを再現し、
 * 内部のMapベースの出現回数カウント（O(1)）のみで重複を検知するため、大容量文書での
 * 重複検知リトライのO(n^2)化を再発させない（007-fix-body-link-jump research.md Decision 1）。
 * 見出しテキストが記号・絵文字のみで空スラッグになった場合は`heading`にフォールバックする。
 */
const slugger = new GithubSlugger()

function slugify(text: string): string {
  return slugger.slug(text) || slugger.slug('heading')
}

/**
 * md.parse()（1文書のパース）の開始ごとにsluggerをリセットし、GitHub本来の挙動
 * （1ファイル内でのみ重複をカウントする）を再現する。複数タブ間でのアンカーIDの
 * グローバル一意性は保証しないが、ジャンプ先探索をタブ内に限定することで実害を防ぐ
 * （007-fix-body-link-jump research.md Decision 3、spec.md Assumptions）。
 */
md.core.ruler.before('normalize', 'reset_heading_slugger', () => {
  slugger.reset()
})

md.use(anchor, {
  level: [1, 2, 3, 4, 5, 6],
  slugify
})

/** パース済みトークン列から見出しの階層構造を抽出する（FR-003） */
export function extractHeadingsFromTokens(tokens: Tokens): Heading[] {
  const root: Heading[] = []
  const stack: Heading[] = []

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.type !== 'heading_open') {
      continue
    }

    const level = Number(token.tag.slice(1))
    const inlineToken = tokens[i + 1]
    const heading: Heading = {
      level,
      text: inlineToken?.content ?? '',
      anchorId: String(token.attrGet('id') ?? ''),
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

/** rawContentから直接見出しを抽出する簡易版（テスト・単発利用向け） */
export function extractHeadings(rawContent: string): Heading[] {
  const { tokens } = parseDocument(rawContent)
  return extractHeadingsFromTokens(tokens)
}
