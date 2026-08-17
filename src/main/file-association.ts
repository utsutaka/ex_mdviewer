import { execFile } from 'node:child_process'

const PROG_ID = 'mdviewer.md'

interface RegResult {
  success: boolean
  stderr: string
}

/** `reg.exe`をchild_process経由で実行する（research.md Decision 7, 15） */
function runReg(args: string[]): Promise<RegResult> {
  return new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) {
        resolve({ success: false, stderr: stderr || error.message })
      } else {
        resolve({ success: true, stderr: '' })
      }
    })
  })
}

/**
 * mdviewer自身が過去に作成した可能性のあるファイル関連付け用レジストリキーを
 * 起動時に自動検出・削除する（002-remove-file-association FR-007）。キーが
 * 存在しない場合、削除自体に失敗した場合のいずれも、エラーとして扱わず・
 * 利用者への通知も行わずに正常完了する冪等な処理とする。
 */
export async function cleanupLegacyFileAssociation(): Promise<void> {
  await runReg(['delete', `HKCU\\Software\\Classes\\${PROG_ID}`, '/f'])
  await runReg(['delete', 'HKCU\\Software\\Classes\\.md\\OpenWithProgids', '/v', PROG_ID, '/f'])
}
