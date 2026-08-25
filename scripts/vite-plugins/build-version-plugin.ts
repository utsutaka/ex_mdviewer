import { execFileSync } from 'node:child_process'
import type { Plugin } from 'vite'

/**
 * git rev-parse --is-inside-work-tree を実行し、gitコマンドが利用可能な
 * ワークツリー内であるかを判定する（research.md Decision 2）。
 */
export function isGitAvailable(cwd: string): boolean {
  try {
    const result = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return result.trim() === 'true'
  } catch {
    return false
  }
}

/**
 * HEADコミットのコミット日時を、ビルドを実行する環境のローカルタイムで
 * YYYYMMDD-hhmmss形式に整形して取得する（research.md Decision 1）。
 * コミットが1件も存在しない等の理由で失敗した場合は例外を投げる
 * （呼び出し元のresolveBuildVersionでフォールバックへ捕捉させる）。
 */
export function getCommitTimestamp(cwd: string): string {
  const result = execFileSync(
    'git',
    ['log', '-1', '--format=%cd', '--date=format-local:%Y%m%d-%H%M%S', 'HEAD'],
    { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
  )
  return result.trim()
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * gitのコミット履歴が利用できない環境向けのフォールバック値を生成する
 * （ビルド実行時刻＋非公式マーカー、research.md Decision 4）。
 */
export function buildFallbackVersion(now: Date = new Date()): string {
  const y = now.getFullYear()
  const mo = pad(now.getMonth() + 1)
  const d = pad(now.getDate())
  const h = pad(now.getHours())
  const mi = pad(now.getMinutes())
  const s = pad(now.getSeconds())
  return `${y}${mo}${d}-${h}${mi}${s}+unofficial`
}

/**
 * ビルド時のバージョン文字列を確定する（FR-005〜FR-009）。
 * git利用可否の判定・コミット日時の取得のいずれかが失敗した場合は、
 * 理由を問わずフォールバックへ到達させる（FR-009: タイムアウトや権限不足等、
 * FR-007が列挙する条件に限らない予期しない失敗も対象に含む）。
 */
export function resolveBuildVersion(cwd: string): string {
  try {
    if (!isGitAvailable(cwd)) {
      return buildFallbackVersion()
    }
    return getCommitTimestamp(cwd)
  } catch {
    return buildFallbackVersion()
  }
}

const VIRTUAL_MODULE_ID = 'virtual:build-version'
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID

/**
 * 仮想モジュール `virtual:build-version` を提供するViteプラグイン
 * （research.md Decision 3）。electron-viteのwatchモードがmainプロセスを
 * 再ビルドするたびに`load`フックが再評価されるため、`npm run dev`での
 * 保存時再ビルドでも最新のバージョン文字列が反映される（FR-010）。
 */
export function buildVersionPlugin(): Plugin {
  return {
    name: 'mdviewer:build-version',
    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID
      }
      return undefined
    },
    load(id) {
      if (id === RESOLVED_VIRTUAL_MODULE_ID) {
        const version = resolveBuildVersion(process.cwd())
        return `export const BUILD_VERSION = ${JSON.stringify(version)}\n`
      }
      return undefined
    }
  }
}
