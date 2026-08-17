/**
 * ビルド・パッケージングで生成される成果物フォルダ（out/, release/, dist/）を削除する。
 * これらはいずれもdev/build/pack実行時に自動で再生成されるため、削除しても安全。
 * dist/はelectron-builderを使っていた頃の名残で現在は生成されないが、
 * 念のため削除対象に含める。
 */
import { existsSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targets = ['out', 'release', 'dist']

for (const target of targets) {
  const targetPath = resolve(root, target)
  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true })
    console.log(`削除しました: ${target}/`)
  } else {
    console.log(`存在しないためスキップ: ${target}/`)
  }
}
