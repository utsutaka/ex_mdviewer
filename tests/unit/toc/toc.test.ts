import { describe, expect, it } from 'vitest'
import { extractHeadings } from '../../../src/renderer/markdown/toc'

describe('extractHeadings', () => {
  it('フラットな見出し構造を階層化する', () => {
    const headings = extractHeadings('# H1\n\n## H2\n\n### H3\n')
    expect(headings).toHaveLength(1)
    expect(headings[0].text).toBe('H1')
    expect(headings[0].children).toHaveLength(1)
    expect(headings[0].children[0].text).toBe('H2')
    expect(headings[0].children[0].children).toHaveLength(1)
    expect(headings[0].children[0].children[0].text).toBe('H3')
  })

  it('同一レベルの複数見出しを兄弟として扱う', () => {
    const headings = extractHeadings('# A\n\n## B\n\n## C\n')
    expect(headings).toHaveLength(1)
    expect(headings[0].children).toHaveLength(2)
    expect(headings[0].children[0].text).toBe('B')
    expect(headings[0].children[1].text).toBe('C')
  })

  it('レベルが飛んでいる場合も直近の親の子として扱う', () => {
    const headings = extractHeadings('# A\n\n### C\n')
    expect(headings).toHaveLength(1)
    expect(headings[0].children).toHaveLength(1)
    expect(headings[0].children[0].text).toBe('C')
  })

  it('各見出しに一意なanchorIdを付与する（重複テキストでも一意）', () => {
    const headings = extractHeadings('# 見出し1\n\n# 見出し1\n')
    expect(headings).toHaveLength(2)
    expect(headings[0].anchorId).toBeTruthy()
    expect(headings[1].anchorId).toBeTruthy()
    expect(headings[0].anchorId).not.toBe(headings[1].anchorId)
  })

  it('見出しが存在しない場合は空配列を返す', () => {
    expect(extractHeadings('本文のみ\n')).toEqual([])
  })

  it('見出しテキストをGitHub互換のスラッグ形式（小文字化・記号のハイフン化）に変換する', () => {
    const headings = extractHeadings('# 1. AGENTS.md とは\n')
    expect(headings[0].anchorId).toBe('1-agentsmd-とは')
  })

  it('同一見出しテキストが重複する場合、初出には連番を付与せず2番目以降にのみ連番を付与する', () => {
    const headings = extractHeadings('# 見出し\n\n# 見出し\n\n# 見出し\n')
    expect(headings[0].anchorId).toBe('見出し')
    expect(headings[1].anchorId).toBe('見出し-1')
    expect(headings[2].anchorId).toBe('見出し-2')
  })

  it('見出しが記号・絵文字のみで空スラッグになる場合でもIDの生成に失敗しない', () => {
    const headings = extractHeadings('# !!!\n\n# 😄\n')
    expect(headings[0].anchorId).toBeTruthy()
    expect(headings[1].anchorId).toBeTruthy()
    expect(headings[0].anchorId).not.toBe(headings[1].anchorId)
  })

  it('文書ごとにスラッグ生成器がリセットされ、他の呼び出し結果の影響を受けない', () => {
    const firstDocHeadings = extractHeadings('# 見出し\n')
    const secondDocHeadings = extractHeadings('# 見出し\n')
    expect(firstDocHeadings[0].anchorId).toBe('見出し')
    expect(secondDocHeadings[0].anchorId).toBe('見出し')
  })
})
