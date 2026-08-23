import { describe, expect, it } from 'vitest'
import { parseCsvLenient, renderCsvTable } from '../../../src/renderer/markdown/csv-table'

describe('parseCsvLenient', () => {
  it('基本的なカンマ区切りを行×セルの二次元配列に変換する', () => {
    expect(parseCsvLenient('name,age\nAlice,30\nBob,25\n')).toEqual([
      ['name', 'age'],
      ['Alice', '30'],
      ['Bob', '25']
    ])
  })

  it('ダブルクォートで囲まれたフィールド内のカンマを区切りとして誤認識しない', () => {
    expect(parseCsvLenient('name,age\n"Doe, John",30\n')).toEqual([
      ['name', 'age'],
      ['Doe, John', '30']
    ])
  })

  it('ダブルクォートで囲まれたフィールド内の改行を行区切りとして誤認識しない', () => {
    expect(parseCsvLenient('a,b\n"multi\nline",1\n')).toEqual([
      ['a', 'b'],
      ['multi\nline', '1']
    ])
  })

  it('""を1つのダブルクォート文字として扱う', () => {
    expect(parseCsvLenient('a\n"say ""hi"""\n')).toEqual([['a'], ['say "hi"']])
  })

  it('引用符で囲まれていない値の前後の空白をトリムしない', () => {
    expect(parseCsvLenient('a, b , c\n')).toEqual([['a', ' b ', ' c']])
  })

  it('末尾がちょうど1個の改行で終わる場合は新たな行を生成しない', () => {
    expect(parseCsvLenient('a,b\n')).toEqual([['a', 'b']])
  })

  it('改行を含まない入力でも最後の行を確定する', () => {
    expect(parseCsvLenient('a,b')).toEqual([['a', 'b']])
  })
})

describe('renderCsvTable', () => {
  it('1行目をヘッダー行(<th>)、2行目以降をデータ行(<td>)として<table>を生成する', () => {
    const html = renderCsvTable('name,age\nAlice,30\n')
    expect(html).toBe('<table><thead><tr><th>name</th><th>age</th></tr></thead><tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>')
  })

  it('ヘッダー行のみで1行しかない場合、データ行0件の表になる', () => {
    const html = renderCsvTable('name,age\n')
    expect(html).toBe('<table><thead><tr><th>name</th><th>age</th></tr></thead><tbody></tbody></table>')
  })

  it('カンマを含まない1列のみのCSVは1列の表になる', () => {
    const html = renderCsvTable('name\nAlice\nBob\n')
    expect(html).toBe(
      '<table><thead><tr><th>name</th></tr></thead><tbody><tr><td>Alice</td></tr><tr><td>Bob</td></tr></tbody></table>'
    )
  })

  it('ヘッダー・データ両方のセル値のHTML特殊文字を常にエスケープする', () => {
    const html = renderCsvTable('<b>col</b>&"\'\n<script>alert(1)</script>,2\n')
    expect(html).toContain('<th>&lt;b&gt;col&lt;/b&gt;&amp;&quot;&#39;</th>')
    expect(html).toContain('<td>&lt;script&gt;alert(1)&lt;/script&gt;</td>')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('内容が空文字列（前後の空白のみを含む）の場合は空文字列を返す', () => {
    expect(renderCsvTable('')).toBe('')
    expect(renderCsvTable('   \n  \n')).toBe('')
  })

  it('ヘッダーより列数が少ない行は不足セルを空欄で補い、多い行は超過セルも表示する', () => {
    const html = renderCsvTable('a,b,c\n1\n2,3,4,5\n')
    expect(html).toContain('<tr><td>1</td><td></td><td></td></tr>')
    expect(html).toContain('<tr><td>2</td><td>3</td><td>4</td><td>5</td></tr>')
  })

  it('ヘッダー行に同一の列名が重複していてもそのまま両方保持する', () => {
    const html = renderCsvTable('a,a\n1,2\n')
    expect(html).toContain('<thead><tr><th>a</th><th>a</th></tr></thead>')
  })

  it('ヘッダー行自体が空行（列数0）の場合、データ行のセルは超過セルとしてすべて表示される', () => {
    const html = renderCsvTable('\nx,y\n')
    expect(html).toBe('<table><thead><tr><th></th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table>')
  })
})

describe('parseCsvLenient - 引用符の寛容な扱い3パターン（US2, FR-006）', () => {
  it('パターン1: 引用符が閉じられないままEOFに達した場合、そこまでの内容をセル値として確定する', () => {
    expect(parseCsvLenient('a,b\n"unterminated')).toEqual([
      ['a', 'b'],
      ['unterminated']
    ])
  })

  it('パターン2: フィールドの先頭以外に出現する引用符は通常の文字として扱う', () => {
    expect(parseCsvLenient('ab"cd,ef\n')).toEqual([['ab"cd', 'ef']])
  })

  it('パターン3: 閉じた引用符の直後に続く文字はそのままセル値へ連結する', () => {
    expect(parseCsvLenient('"abc"def,2\n')).toEqual([['abcdef', '2']])
  })

  it('同一行内で一部のフィールドのみ引用符で囲まれていても正しく解析する', () => {
    expect(parseCsvLenient('"a",b,"c"\n')).toEqual([['a', 'b', 'c']])
  })
})

describe('parseCsvLenient - 行区切り・空行・連続区切り文字（US2, FR-003, Edge Cases）', () => {
  it('CRLFを行区切りとして扱う', () => {
    expect(parseCsvLenient('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })

  it('CRLFとLFが混在していても正しく行を区切る', () => {
    expect(parseCsvLenient('a\r\nb\nc')).toEqual([['a'], ['b'], ['c']])
  })

  it('ブロック中間の完全な空行は空文字列1個のセルを持つ行として扱う', () => {
    expect(parseCsvLenient('a,b\n\nc,d\n')).toEqual([['a', 'b'], [''], ['c', 'd']])
  })

  it('連続するカンマは空文字列のセルとして扱う', () => {
    expect(parseCsvLenient('a,,b\n')).toEqual([['a', '', 'b']])
  })
})

describe('parseCsvLenient - 大量データ・極端な値（US2, FR-010）', () => {
  it('極端に長い1つのフィールド値でも切り詰めずそのまま1セルとして保持する', () => {
    const longValue = 'x'.repeat(5000)
    expect(parseCsvLenient(`a\n${longValue}\n`)).toEqual([['a'], [longValue]])
  })

  it('固定の行数上限を設けず、大量行を切り詰めずにすべて解析する', () => {
    const rowCount = 1000
    const dataLines = Array.from({ length: rowCount }, (_, i) => `v${i}`).join('\n')
    const rows = parseCsvLenient(`col\n${dataLines}\n`)
    expect(rows).toHaveLength(rowCount + 1)
    expect(rows[rowCount]).toEqual([`v${rowCount - 1}`])
  })
})
