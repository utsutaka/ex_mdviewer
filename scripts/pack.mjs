/**
 * npm run build のビルド成果物(out/)と、実行に必要なnode_modules
 * （electron本体を含む）を1つのフォルダにまとめ、release/mdviewer.zip として
 * 出力する。Node.js未インストールの別PCでも、ZIP解凍後にmdviewer.batを
 * ダブルクリックするだけで起動できる状態を作る（constitution原則III:
 * EXE化は行わないため、electron-builder等のパッケージングツールは使わない）。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'out')
const releaseDir = resolve(root, 'release')
const stageDir = resolve(releaseDir, 'mdviewer')
const zipPath = resolve(releaseDir, 'mdviewer.zip')

if (!existsSync(outDir)) {
  console.error('out/ が見つかりません。先に npm run build を実行してください。')
  process.exit(1)
}

console.log('配布用フォルダを準備しています...')
rmSync(releaseDir, { recursive: true, force: true })
mkdirSync(stageDir, { recursive: true })

console.log('ビルド成果物をコピーしています...')
cpSync(outDir, resolve(stageDir, 'out'), { recursive: true })

console.log('README.mdから利用方法を抽出しています...')
// ルート直下のREADME.mdは開発者向け章（npmコマンド・フォルダ構成・開発手順等）と
// 利用者向け章（利用方法）が同居しているため、配布ZIPには「## 利用方法」以降のみを
// 抜き出して同梱する。README.md本体を単一の情報源とし、二重管理を避ける
const readmeContent = readFileSync(resolve(root, 'README.md'), 'utf-8')
const usageHeading = '## 利用方法\n'
const usageIndex = readmeContent.indexOf(usageHeading)
if (usageIndex === -1) {
  console.error('README.mdに「## 利用方法」セクションが見つかりません。')
  process.exit(1)
}
const usageSection = readmeContent.slice(usageIndex + usageHeading.length).trimStart()
writeFileSync(resolve(stageDir, 'README.md'), `# mdviewer\n\n${usageSection}`)

console.log('配布用package.jsonを作成しています...')
const rootPkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'))
const stagePkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  private: true,
  dependencies: {
    ...rootPkg.dependencies,
    // electron本体はdevDependencies扱いだが、配布物には実行バイナリとして必須
    electron: rootPkg.devDependencies.electron
  }
}
writeFileSync(resolve(stageDir, 'package.json'), JSON.stringify(stagePkg, null, 2))

console.log('実行に必要な依存関係をインストールしています...')
// npm.cmdはバッチファイルのため、Node.jsから直接spawnできずcmd.exe経由で呼び出す
execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm', 'install'], { cwd: stageDir, stdio: 'inherit' })

console.log('Electron本体（実行バイナリ）をダウンロードしています...')
// electronパッケージは初回実行時に遅延ダウンロードする方式のため、npm installだけでは
// electron.exeが取得されない。install.jsを直接実行して明示的にダウンロードを完了させる
execFileSync(
  process.execPath,
  [resolve(stageDir, 'node_modules', 'electron', 'install.js')],
  {
    cwd: resolve(stageDir, 'node_modules', 'electron'),
    stdio: 'inherit',
    // 一部環境ではプロキシ経由でないとelectronバイナリのダウンロードに失敗するため、
    // package.jsonのpostinstallと同様にELECTRON_GET_USE_PROXYを有効化する
    env: { ...process.env, ELECTRON_GET_USE_PROXY: 'true' }
  }
)

console.log('起動用バッチファイルを作成しています...')
// node_modules\.bin\electron.cmd はNode.js自体を必要とするため使わず、
// 同梱したElectron本体(electron.exe)を直接呼び出す
// startで別プロセスとして切り離すことで、cmdウィンドウを閉じてもアプリは終了せず、
// cmd自身も起動直後に自然終了する(黒い画面が一瞬表示されて消えるだけになる)
writeFileSync(
  resolve(stageDir, 'mdviewer.bat'),
  '@echo off\r\nstart "" "%~dp0node_modules\\electron\\dist\\electron.exe" "%~dp0out\\main\\index.js"\r\n'
)

console.log('サイレント起動用VBScriptを作成しています...')
// cmdウィンドウの一瞬の点滅も許容できない場合向けに、mdviewer.batを
// 非表示(SW_HIDE)で呼び出すだけのランチャーを別途用意する
// 起動ロジック(electron.exeやindex.jsのパス)はmdviewer.bat側の1箇所に集約し、
// 変更時の修正漏れによる不整合を防ぐ
writeFileSync(
  resolve(stageDir, 'mdviewer-silent.vbs'),
  [
    'Set objShell = CreateObject("WScript.Shell")',
    'Set objFSO = CreateObject("Scripting.FileSystemObject")',
    'strFolder = objFSO.GetParentFolderName(WScript.ScriptFullName)',
    'objShell.Run """" & strFolder & "\\mdviewer.bat" & """", 0, False'
  ].join('\r\n') + '\r\n'
)

console.log('ZIPファイルを作成しています...')
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '& { param($src, $dest) Compress-Archive -LiteralPath $src -DestinationPath $dest -Force }',
    stageDir,
    zipPath
  ],
  { stdio: 'inherit' }
)

console.log(`完了しました: ${zipPath}`)
