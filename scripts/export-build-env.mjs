/**
 * npm run pack まで実行可能な「ビルド環境の必須構成」だけを抜き出し、
 * utsutaka フォルダへ mmdd_nn_ プレフィックス付きZIPとして出力する。
 * このリポジトリとは別に、ビルド環境のみを公開したい場合の素材作成用。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stageDir = resolve(root, '.temp', 'export-build-env-stage')
const utsutakaDir = resolve(root, 'utsutaka')

// npm run pack までを公開する場合の必須構成
const includePaths = [
  'src',
  'package.json',
  'package-lock.json',
  'electron.vite.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'scripts/pack.mjs',
  'scripts/cleanup.mjs',
  'README.md'
]

console.log('ステージング用フォルダを準備しています...')
rmSync(stageDir, { recursive: true, force: true })
mkdirSync(stageDir, { recursive: true })

for (const relPath of includePaths) {
  const src = resolve(root, relPath)
  if (!existsSync(src)) {
    console.error(`対象ファイルが見つかりません: ${relPath}`)
    process.exit(1)
  }
  const dest = resolve(stageDir, relPath)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest, { recursive: true })
}

console.log('出力ファイル名を決定しています...')
// 同日内の連番は utsutaka フォルダ内の既存ファイル名から自動採番する
const now = new Date()
const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
mkdirSync(utsutakaDir, { recursive: true })
const usedSeqs = readdirSync(utsutakaDir)
  .map((name) => name.match(new RegExp(`^${mmdd}_(\\d{2})_`)))
  .filter((match) => match !== null)
  .map((match) => Number(match[1]))
const nextSeq = usedSeqs.length > 0 ? Math.max(...usedSeqs) + 1 : 1
const zipName = `${mmdd}_${String(nextSeq).padStart(2, '0')}_mdviewer-build-env.zip`
const zipPath = resolve(utsutakaDir, zipName)

console.log('ZIPファイルを作成しています...')
// フォルダ自体ではなく直下の内容をZIP化するため、ワイルドカード指定で圧縮する
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '& { param($src, $dest) Compress-Archive -Path "$src\\*" -DestinationPath $dest -Force }',
    stageDir,
    zipPath
  ],
  { stdio: 'inherit' }
)

console.log('ステージング用フォルダを削除しています...')
rmSync(stageDir, { recursive: true, force: true })

console.log(`完了しました: ${zipPath}`)
