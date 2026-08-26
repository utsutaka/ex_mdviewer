const MAX_FOLDER_HISTORY = 10

/**
 * フォルダ履歴内の同一性判定用にパスを正規化する（大文字小文字を区別せず、末尾の区切り文字を
 * 正規化して比較する、031-folder-history-menu spec.md Assumptions）。
 * ドライブ直下（例: `D:\`）は、区切り文字を単純に除去すると`D:`になってしまい、Windows上で
 * 意味の異なるパス（`D:`はプロセスのカレントディレクトリ、`D:\`はドライブルート）と誤って
 * 同一視されるため、ドライブ直下の場合のみ区切り文字を復元する（research.md Decision 8）。
 */
function normalizeFolderPath(folderPath: string): string {
  const trimmed = folderPath.replace(/[\\/]+$/, '')
  const normalized = /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed
  return normalized.toLowerCase()
}

/**
 * フォルダ履歴へ`folderPath`を追加する（031-folder-history-menu FR-001〜FR-003）。
 * 既存の同一フォルダは取り除いてから先頭に追加するため、キャップ到達後の再訪問でも
 * 他のエントリが誤って削除されることはない（research.md Decision 2）。
 */
export function addFolderToHistory(history: string[], folderPath: string): string[] {
  const normalized = normalizeFolderPath(folderPath)
  const filtered = history.filter((entry) => normalizeFolderPath(entry) !== normalized)
  return [folderPath, ...filtered].slice(0, MAX_FOLDER_HISTORY)
}
