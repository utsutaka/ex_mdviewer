import { app } from 'electron'

/**
 * app.getPath('userData')はapp.getName()に依存し、既定値はpackage.jsonの"name"から
 * 解決されるが、electron-vite devやelectron.exeへスクリプトパスを直接渡す起動方式では
 * 正しく解決されない場合がある（実機確認済み）。設定ファイルの保存先を
 * `%APPDATA%\mdviewer\config.json` に固定するため（constitution原則VI）、
 * 他のいかなるmainプロセスモジュールよりも先にこの副作用を実行する必要がある。
 * index.tsの最初のローカルimportとして本モジュールを配置すること。
 */
app.setName('mdviewer')
