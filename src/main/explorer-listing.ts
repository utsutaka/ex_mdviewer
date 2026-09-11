import { join, resolve } from 'node:path'
import type { ExplorerEntry } from '@shared/types'
import { resolveFileKind } from '@shared/file-kind'

/** `fs.readdir(dir, { withFileTypes: true })`のdirentから必要な情報だけを取り出した形（テスト容易性のため） */
export interface ExplorerDirEntry {
  name: string
  isFile: boolean
}

/** 同一ファイル判定用のパス正規化（`ipc/handlers.ts`の`normalizePath`と同じ方式、大文字小文字を区別しない） */
function normalizePath(filePath: string): string {
  return resolve(filePath).toLowerCase()
}

/**
 * フォルダ直下のエントリ一覧から、エクスプローラーバーに表示するファイル一覧を構築する
 * 純粋関数（038-explorer-sidebar research.md Decision 2〜4）。
 * - `entries`のうち`isFile`が`false`のもの（サブフォルダ等）を除外する（FR-002）
 * - 対応拡張子（`resolveFileKind(name) !== null`）でフィルタする（FR-001, research.md Decision 3）
 * - `dirPath`と結合して絶対パスを構築する
 * - `activeFilePath`/`openFilePaths`と比較し、「表示中／開いている／未オープン」の3状態を
 *   判定する（FR-018, research.md Decision 4）
 * - ファイル名の辞書順（大文字小文字を区別しない）にソートする（spec.md Assumptions）
 */
export function buildExplorerEntries(
  dirPath: string,
  entries: ExplorerDirEntry[],
  activeFilePath: string | null,
  openFilePaths: string[]
): ExplorerEntry[] {
  const normalizedActive = activeFilePath !== null ? normalizePath(activeFilePath) : null
  const normalizedOpen = new Set(openFilePaths.map(normalizePath))

  const result: ExplorerEntry[] = []
  for (const entry of entries) {
    if (!entry.isFile) {
      continue
    }
    const fileKind = resolveFileKind(entry.name)
    if (fileKind === null) {
      continue
    }
    const filePath = join(dirPath, entry.name)
    const normalized = normalizePath(filePath)
    const state: ExplorerEntry['state'] =
      normalizedActive !== null && normalized === normalizedActive
        ? 'active'
        : normalizedOpen.has(normalized)
          ? 'open'
          : 'closed'
    result.push({ name: entry.name, filePath, fileKind, state })
  }

  return result.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}
