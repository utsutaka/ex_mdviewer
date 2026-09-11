import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildExplorerEntries } from '../../../src/main/explorer-listing'

const DIR = join('C:', 'Users', 'test', 'notes')

function p(name: string): string {
  return join(DIR, name)
}

describe('buildExplorerEntries', () => {
  it('対応拡張子と非対応拡張子が混在する場合、対応拡張子のみを一覧に含める', () => {
    const result = buildExplorerEntries(
      DIR,
      [
        { name: 'README.md', isFile: true },
        { name: 'notes.txt', isFile: true },
        { name: 'data.json', isFile: true }
      ],
      null,
      []
    )

    expect(result.map((entry) => entry.name)).toEqual(['data.json', 'README.md'])
  })

  it('ファイルと同名の対応拡張子を持つサブフォルダを一覧から除外する', () => {
    const result = buildExplorerEntries(
      DIR,
      [
        { name: 'README.md', isFile: true },
        { name: 'archive.md', isFile: false }
      ],
      null,
      []
    )

    expect(result.map((entry) => entry.name)).toEqual(['README.md'])
  })

  it('アクティブファイル・別タブで開いているファイル・未オープンファイルの3状態を判定する', () => {
    const result = buildExplorerEntries(
      DIR,
      [
        { name: 'active.md', isFile: true },
        { name: 'open.md', isFile: true },
        { name: 'closed.md', isFile: true }
      ],
      p('active.md'),
      [p('active.md'), p('open.md')]
    )

    expect(result.find((entry) => entry.name === 'active.md')?.state).toBe('active')
    expect(result.find((entry) => entry.name === 'open.md')?.state).toBe('open')
    expect(result.find((entry) => entry.name === 'closed.md')?.state).toBe('closed')
  })

  it('パスの大文字小文字が異なっていても同一ファイルとして状態を判定する', () => {
    const result = buildExplorerEntries(DIR, [{ name: 'Active.MD', isFile: true }], p('ACTIVE.md'), [])

    expect(result[0]?.state).toBe('active')
  })

  it('ファイル名を大文字小文字を区別しない辞書順でソートする', () => {
    const result = buildExplorerEntries(
      DIR,
      [
        { name: 'banana.md', isFile: true },
        { name: 'Apple.md', isFile: true },
        { name: 'cherry.md', isFile: true }
      ],
      null,
      []
    )

    expect(result.map((entry) => entry.name)).toEqual(['Apple.md', 'banana.md', 'cherry.md'])
  })

  it('対応ファイルが1件もない場合は空配列を返す', () => {
    const result = buildExplorerEntries(DIR, [{ name: 'notes.txt', isFile: true }], null, [])

    expect(result).toEqual([])
  })
})
