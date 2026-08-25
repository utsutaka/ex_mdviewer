import { BUILD_VERSION } from 'virtual:build-version'

/**
 * ビルド時に確定したバージョン文字列（YYYYMMDD-hhmmss形式）。
 * 非公式ビルド（gitのコミット履歴を持たない環境でのビルド）の場合は
 * 末尾に`+unofficial`が付与される（FR-004, FR-007）。
 * この値はビルド成果物へ焼き込まれた定数であり、配布後のアプリ実行時に
 * gitコマンドへ依存することはない（FR-008）。
 */
export const appVersion = BUILD_VERSION
