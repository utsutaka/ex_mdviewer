import chokidar, { type FSWatcher } from 'chokidar'
import { readFile } from 'node:fs/promises'
import type { FileMissingPayload, FileOpenedPayload, YamlDocumentGroup } from '@shared/types'
import { resolveFileKind } from '@shared/file-kind'
import { decodeFileBuffer } from './file-encoding'
import { isPdfSignatureValid } from './pdf-signature'
import { yamlToStructuredNodes } from './yaml-adapter'
import { getMainWindow } from './window'

let watcher: FSWatcher | null = null
const pathToTabIds = new Map<string, Set<string>>()

function getWatcher(): FSWatcher {
  if (!watcher) {
    watcher = chokidar.watch([], { ignoreInitial: true })
    watcher.on('change', (filePath) => void handleChange(filePath))
    watcher.on('unlink', (filePath) => notifyMissing(filePath))
    // chokidarのerrorイベントは対象パスを特定できない場合があるため、
    // 監視中の全パスへ到達不能を通知する（v1のシンプルさを優先、research.md Decision 25）
    watcher.on('error', () => {
      for (const filePath of pathToTabIds.keys()) {
        notifyMissing(filePath)
      }
    })
  }
  return watcher
}

/** 表示中ファイルの監視を開始する（同一パスを複数タブが開いている場合も1つの監視に集約） */
export function watchFile(filePath: string, tabId: string): void {
  let tabIds = pathToTabIds.get(filePath)
  if (!tabIds) {
    tabIds = new Set()
    pathToTabIds.set(filePath, tabIds)
    getWatcher().add(filePath)
  }
  tabIds.add(tabId)
}

/** タブがクローズされた際、当該タブの監視登録を解除する */
export function unwatchFile(filePath: string, tabId: string): void {
  const tabIds = pathToTabIds.get(filePath)
  if (!tabIds) {
    return
  }
  tabIds.delete(tabId)
  if (tabIds.size === 0) {
    pathToTabIds.delete(filePath)
    getWatcher().unwatch(filePath)
  }
}

/** 外部変更検知時、再読込・エンコーディング再検出を行いfile-changedを送出する（FR-008） */
async function handleChange(filePath: string): Promise<void> {
  const win = getMainWindow()
  const tabIds = pathToTabIds.get(filePath)
  if (!win || !tabIds) {
    return
  }

  try {
    const buffer = await readFile(filePath)
    const fileKind = resolveFileKind(filePath) ?? 'markdown'

    const { content, encodingStatus, isEmptyFile, isInvalidPdf } = ((): {
      content: string
      encodingStatus: FileOpenedPayload['encodingStatus']
      isEmptyFile: boolean
      isInvalidPdf: boolean
    } => {
      if (fileKind === 'pdf') {
        // PDFはバイナリのためdecodeFileBufferを呼ばない（011-html-pdf-viewer research.md Decision 4）
        const isEmpty = buffer.length === 0
        return {
          content: '',
          encodingStatus: 'utf-8',
          isEmptyFile: isEmpty,
          isInvalidPdf: !isEmpty && !isPdfSignatureValid(buffer)
        }
      }
      const decoded = decodeFileBuffer(buffer)
      return {
        ...decoded,
        isEmptyFile: fileKind === 'html' ? decoded.content === '' : false,
        isInvalidPdf: false
      }
    })()

    let yamlDocuments: YamlDocumentGroup[] | null = null
    let structuredParseError = false
    if (fileKind === 'yaml' && content !== '') {
      try {
        yamlDocuments = yamlToStructuredNodes(content)
      } catch {
        structuredParseError = true
      }
    }

    for (const tabId of tabIds) {
      const payload: FileOpenedPayload = {
        tabId,
        filePath,
        rawContent: content,
        encodingStatus,
        headings: [],
        loadStatus: 'loaded',
        fileKind,
        yamlDocuments,
        structuredParseError,
        isEmptyFile,
        isInvalidPdf
      }
      win.webContents.send('file-changed', payload)
    }
  } catch {
    notifyMissing(filePath)
  }
}

/**
 * 削除・リネーム・ドライブ切断による到達不能を、再試行やデバウンスの猶予を設けず
 * 検知時点で直ちに通知する（FR-018）。直前の表示内容はrenderer側で保持される。
 */
function notifyMissing(filePath: string): void {
  const win = getMainWindow()
  const tabIds = pathToTabIds.get(filePath)
  if (!win || !tabIds) {
    return
  }
  for (const tabId of tabIds) {
    const payload: FileMissingPayload = { tabId, filePath }
    win.webContents.send('file-missing', payload)
  }
}
