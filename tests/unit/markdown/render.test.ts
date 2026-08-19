import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../../src/renderer/markdown/render'

describe('renderMarkdown', () => {
  it('GFMテーブルをtable要素へ変換する', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('取り消し線をs要素へ変換する', () => {
    const html = renderMarkdown('~~取り消し線~~')
    expect(html).toContain('<s>取り消し線</s>')
  })

  it('タスクリストをチェックボックス（無効化状態）へ変換する', () => {
    const html = renderMarkdown('- [ ] 未完了\n- [x] 完了\n')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('disabled')
    expect(html).toContain('checked')
  })

  it('コードブロックにhighlight.jsによるシンタックスハイライトを適用する', () => {
    const html = renderMarkdown('```js\nconst x = 1;\n```\n')
    expect(html).toContain('hljs')
    expect(html).toContain('language-js')
  })

  it('未知の言語のコードブロックはエスケープされたプレーンテキストとして出力する', () => {
    const html = renderMarkdown('```mermaid\ngraph TD;\nA-->B;\n```\n')
    expect(html).toContain('language-mermaid')
    expect(html).toContain('graph TD;')
  })

  it('見出し・段落など基本的なMarkdown記法を変換する', () => {
    const html = renderMarkdown('# タイトル\n\n本文です。\n')
    expect(html).toContain('<h1')
    expect(html).toContain('本文です。')
  })
})
