/**
 * ```csvフェンスコードブロックを表（<table>）に変換するための解析・描画処理。
 * 026-csv-table-render spec.mdの決定に基づき、RFC4180準拠の引用規則をベースとしつつ、
 * 崩れた形式（列数不揃い・引用符の閉じ忘れ等）でも常にベストエフォートで解析する
 * （専用の「解析失敗」状態は持たない、FR-006）。
 */

/**
 * RFC4180準拠の寛容な状態遷移パーサー。
 * ダブルクォートで囲まれたフィールド内のカンマ・改行・""エスケープを1セル値として扱う（FR-003）。
 * CRLF・LFのいずれも行区切りとして扱い、中間の空行は空文字列1個のセルを持つ行として扱う。
 * ただし末尾がちょうど1個の改行で終わる場合は、新たな行を生成しない（FR-003）。
 * フィールドの先頭以外に現れるダブルクォートは通常の文字として扱い、閉じた引用符の直後に
 * 続く文字はそのままセル値へ連結する（引用符の使用に関する寛容な規則、FR-006）。
 * 引用符で囲まれていない値の前後の空白はトリムしない（FR-013）。
 */
export function parseCsvLenient(source: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let fieldStarted = false
  let inQuotes = false
  let rowHasContent = false
  let i = 0
  const n = source.length

  const endField = (): void => {
    currentRow.push(currentField)
    currentField = ''
    fieldStarted = false
  }

  const endRow = (): void => {
    endField()
    rows.push(currentRow)
    currentRow = []
    rowHasContent = false
  }

  while (i < n) {
    rowHasContent = true
    const ch = source[i]

    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          currentField += '"'
          i += 2
        } else {
          // 閉じ引用符。EOFまで見つからない場合はループが終了するだけで、
          // 末尾でそこまでの内容をベストエフォートでセル値として確定する（FR-006パターン1）
          inQuotes = false
          i += 1
        }
      } else {
        currentField += ch
        i += 1
      }
      continue
    }

    if (ch === '"' && !fieldStarted) {
      // フィールドの先頭でのみ引用符を開始とみなす（FR-006パターン2の裏返し）
      inQuotes = true
      fieldStarted = true
      i += 1
      continue
    }

    if (ch === ',') {
      endField()
      i += 1
      continue
    }

    if (ch === '\n') {
      i += 1
      endRow()
      continue
    }

    if (ch === '\r') {
      i += source[i + 1] === '\n' ? 2 : 1
      endRow()
      continue
    }

    // フィールド先頭以外の引用符（FR-006パターン2）・閉じた引用符直後の余剰文字
    // （FR-006パターン3）は、いずれもここで通常の文字として連結される
    currentField += ch
    fieldStarted = true
    i += 1
  }

  if (rowHasContent) {
    endRow()
  }

  return rows
}

/** HTML特殊文字5文字（&,<,>,",'）をエスケープする（FR-012）。`&`を最初に変換し二重エスケープを防ぐ。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * parseCsvLenientの結果を<table>のHTML文字列に変換する。
 * 1行目をヘッダー行（<thead><th>）として扱い（FR-004、重複列名もそのまま保持）、
 * 列数不揃いは空欄補完/超過セル保持で正規化する（FR-005）。
 * ヘッダー・データいずれのセル値も、生成経路によらず常にちょうど1回HTMLエスケープする（FR-012）。
 * sourceが空文字列（前後の空白のみを含めトリム後）の場合は空文字列を返す
 * （呼び出し元でのデフォルトfenceレンダラーへのフォールバック判定に使う）。
 */
export function renderCsvTable(source: string): string {
  if (source.trim() === '') {
    return ''
  }

  const [header, ...dataRows] = parseCsvLenient(source)
  const columnCount = header.length

  const renderRow = (row: string[], cellTag: 'th' | 'td'): string => {
    const cells = row.map((cell) => `<${cellTag}>${escapeHtml(cell)}</${cellTag}>`)
    while (cells.length < columnCount) {
      cells.push(`<${cellTag}></${cellTag}>`)
    }
    return `<tr>${cells.join('')}</tr>`
  }

  const theadHtml = `<thead>${renderRow(header, 'th')}</thead>`
  const tbodyHtml = `<tbody>${dataRows.map((row) => renderRow(row, 'td')).join('')}</tbody>`

  return `<table>${theadHtml}${tbodyHtml}</table>`
}
