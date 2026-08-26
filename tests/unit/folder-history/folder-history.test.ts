import { describe, expect, it } from 'vitest'
import { addFolderToHistory } from '../../../src/main/folder-history'

describe('031-folder-history-menu: addFolderToHistory', () => {
  it('新しいフォルダを先頭に追加する（FR-001）', () => {
    const result = addFolderToHistory(['C:\\B', 'C:\\A'], 'C:\\C')
    expect(result).toEqual(['C:\\C', 'C:\\B', 'C:\\A'])
  })

  it('既に履歴にあるフォルダを再度開くと、重複させず先頭へ移動する（FR-002）', () => {
    const result = addFolderToHistory(['C:\\A', 'C:\\B', 'C:\\C'], 'C:\\B')
    expect(result).toEqual(['C:\\B', 'C:\\A', 'C:\\C'])
  })

  it('大文字小文字のみが異なるフォルダは同一フォルダとみなす（spec.md Assumptions）', () => {
    const result = addFolderToHistory(['C:\\Foo', 'C:\\Bar'], 'c:\\foo')
    expect(result).toEqual(['c:\\foo', 'C:\\Bar'])
  })

  it('末尾の区切り文字のみが異なるフォルダは同一フォルダとみなす（spec.md Assumptions）', () => {
    const result = addFolderToHistory(['C:\\Foo\\', 'C:\\Bar'], 'C:\\Foo')
    expect(result).toEqual(['C:\\Foo', 'C:\\Bar'])
  })

  it('10件を超えて追加される場合、最も古いエントリ（末尾）を削除する（FR-003）', () => {
    const history = Array.from({ length: 10 }, (_, i) => `C:\\Folder${i}`)
    const result = addFolderToHistory(history, 'C:\\NewFolder')
    expect(result).toHaveLength(10)
    expect(result[0]).toBe('C:\\NewFolder')
    expect(result).not.toContain('C:\\Folder9')
  })

  it('10件キャップに達した状態で既存のフォルダを再訪しても、他のエントリは削除されず先頭移動のみが起こる（Edge Cases）', () => {
    const history = Array.from({ length: 10 }, (_, i) => `C:\\Folder${i}`)
    const result = addFolderToHistory(history, 'C:\\Folder9')
    expect(result).toHaveLength(10)
    expect(result[0]).toBe('C:\\Folder9')
    expect(result).toEqual(expect.arrayContaining(history))
  })

  it('ドライブ直下（D:\\）とドライブ直下以外の子フォルダを混同しない（research.md Decision 8）', () => {
    const result = addFolderToHistory(['D:\\'], 'D:\\')
    expect(result).toEqual(['D:\\'])
  })

  it('ドライブ直下のフォルダは正規化してもD:のような不正な形にならない（research.md Decision 8）', () => {
    const result = addFolderToHistory([], 'D:\\')
    const again = addFolderToHistory(result, 'D:\\')
    expect(again).toEqual(['D:\\'])
  })
})
