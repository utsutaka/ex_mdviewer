import hljs from 'highlight.js'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import { renderCsvTable } from './csv-table'

/**
 * GFM相当のMarkdownレンダリングを行うmarkdown-itインスタンス。
 * defaultプリセットはテーブル・取り消し線を標準サポートするため、
 * タスクリストのみプラグイン追加で完結する（research.md Decision 13）。
 * toc.ts/mermaid.tsからも同一インスタンスを再利用し、二重パースを避ける。
 */
export const md = new MarkdownIt('default', {
  html: false,
  linkify: true,
  breaks: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value
      } catch {
        // フォールスルーしてmarkdown-it既定のエスケープ済みプレーンテキスト出力を使う
      }
    }
    return ''
  }
}).use(taskLists, { enabled: false, label: true })

/**
 * ```csvフェンスのみ表（<table>）として描画する（026-csv-table-render FR-001, FR-002）。
 * 空のcsvブロック・他言語のフェンスは既存のデフォルトfenceレンダラーに委譲する。
 */
const defaultFenceRenderer = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim() === 'csv') {
    const tableHtml = renderCsvTable(token.content)
    if (tableHtml !== '') {
      return tableHtml
    }
  }
  return defaultFenceRenderer(tokens, idx, options, env, self)
}

export function renderMarkdown(rawContent: string): string {
  return md.render(rawContent)
}

export type Tokens = ReturnType<typeof md.parse>
export type MarkdownEnv = Record<string, unknown>

/**
 * rawContentを一度だけパースし、トークン列を返す。TOC抽出・Mermaid検出・
 * チャンク描画がそれぞれ独自にmd.parse()し直すと大容量ファイルで多重の
 * 同期ブロッキングが発生するため、呼び出し元で結果を共有する（FR-015, SC-008, SC-010）。
 */
export function parseDocument(rawContent: string): { tokens: Tokens; env: MarkdownEnv } {
  const env: MarkdownEnv = {}
  const tokens = md.parse(rawContent, env)
  return { tokens, env }
}

/**
 * トップレベルトークンをネスト深度0の境界でのみ分割する（テーブル・リスト等の
 * 開始/終了トークン対が別チャンクへ分断されないようにする）。
 */
function groupTokensAtomically(tokens: Tokens, targetGroupSize: number): Tokens[] {
  const groups: Tokens[] = []
  let current: Tokens = []
  let depth = 0

  for (const token of tokens) {
    current.push(token)
    depth += token.nesting
    if (depth === 0 && current.length >= targetGroupSize) {
      groups.push(current)
      current = []
    }
  }
  if (current.length > 0) {
    groups.push(current)
  }
  return groups
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * 大容量ファイル（目安10MB程度）の描画をイベントループへ複数回に分けて投入し、
 * レンダラーのメインスレッドを長時間占有しないようにする（FR-015, SC-008、research.md Decision 22）。
 * トークン列をネスト深度0の境界で分割するため、テーブル・リスト等の構造は分断されない。
 */
export async function renderTokensChunked(
  tokens: Tokens,
  env: MarkdownEnv,
  onChunk: (html: string) => void,
  targetGroupSize = 200
): Promise<void> {
  const groups = groupTokensAtomically(tokens, targetGroupSize)

  for (let i = 0; i < groups.length; i += 1) {
    const html = md.renderer.render(groups[i], md.options, env)
    onChunk(html)
    if (i < groups.length - 1) {
      await yieldToEventLoop()
    }
  }
}

/** rawContentから直接チャンク描画する簡易版（テスト・単発利用向け） */
export async function renderMarkdownChunked(
  rawContent: string,
  onChunk: (html: string) => void,
  targetGroupSize = 200
): Promise<void> {
  const { tokens, env } = parseDocument(rawContent)
  await renderTokensChunked(tokens, env, onChunk, targetGroupSize)
}
