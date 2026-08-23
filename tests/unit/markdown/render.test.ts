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

  it('```csvフェンスを、GFMテーブルと同一の裸のマークアップの<table>へ変換する', () => {
    const html = renderMarkdown('```csv\nname,age\nAlice,30\n```\n')
    expect(html).toContain('<table><thead><tr><th>name</th><th>age</th></tr></thead>')
    expect(html).toContain('<td>Alice</td><td>30</td>')
    expect(html).not.toContain('language-csv')
    expect(html).not.toContain('class="')
  })

  it('csv以外の言語のフェンスは、csvフェンス対応の追加後も従来どおりhighlight.jsによるハイライトのまま変換される', () => {
    const html = renderMarkdown('```js\nconst x = 1;\n```\n')
    expect(html).toContain('hljs')
    expect(html).toContain('language-js')
    expect(html).not.toContain('<table>')
  })

  it('csvブロック由来の<table>は、既存のGFMパイプテーブルと同一の裸のマークアップ（class属性なし、thead/tbody構造）になる', () => {
    const csvHtml = renderMarkdown('```csv\na,b\n1,2\n```\n')
    const gfmHtml = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    expect(csvHtml).toBe('<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')
    expect(csvHtml).not.toContain('class="')
    expect(gfmHtml).not.toContain('class="')
    expect(csvHtml).toContain('<thead>')
    expect(gfmHtml).toContain('<thead>')
    expect(csvHtml).toContain('<tbody>')
    expect(gfmHtml).toContain('<tbody>')
  })

  it('複数のcsvブロックのうち1つが崩れた内容（引用符未閉じ）でも、他の正常なブロックの表への変換に影響しない', () => {
    const html = renderMarkdown(
      '```csv\na,b\n1,2\n```\n\n```csv\nx,y\n"unterminated\n```\n\n```csv\nc,d\n3,4\n```\n'
    )
    expect(html).toContain('<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')
    expect(html).toContain('<table><thead><tr><th>c</th><th>d</th></tr></thead><tbody><tr><td>3</td><td>4</td></tr></tbody></table>')
    expect(html).toContain('unterminated')
  })
})
