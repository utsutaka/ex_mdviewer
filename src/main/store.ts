import { app } from 'electron'
import Store from 'electron-store'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, PersistedStore, WindowState } from '@shared/types'

const CONFIG_FILE_NAME = 'config'

function getConfigPath(): string {
  return join(app.getPath('userData'), `${CONFIG_FILE_NAME}.json`)
}

/**
 * 設定の永続化先（config.json）が存在するかどうかで「設定を保存する」のON/OFFを判定する。
 * 別途の状態フラグは持たない（005-native-menu-save-toggle FR-005, research.md Decision 2）。
 */
export function isPersistenceEnabled(): boolean {
  return existsSync(getConfigPath())
}

const defaultWindowState: WindowState = {
  width: 1000,
  height: 800,
  x: -1,
  y: -1,
  isMaximized: false
}

const defaultAppSettings: AppSettings = {
  theme: 'light',
  tocVisible: true,
  tocWidth: 220,
  contentWidthMode: 'readable'
}

const defaults: PersistedStore = {
  windowState: defaultWindowState,
  appSettings: defaultAppSettings
}

function createStore(initialDefaults: PersistedStore): Store<PersistedStore> {
  return new Store<PersistedStore>({
    name: CONFIG_FILE_NAME,
    cwd: app.getPath('userData'),
    defaults: initialDefaults
  })
}

let wasReset = false

/**
 * config.jsonがパース不能なほど破損している場合、デフォルト設定で上書きして起動を継続する（FR-033）。
 * electron-storeはコンストラクタ内でJSONパースに失敗すると例外を投げるため、
 * catch節でファイルをデフォルト値に上書きしてから再生成する（constitution原則V: ログファイルは残さない）。
 */
function initStore(): Store<PersistedStore> {
  try {
    return createStore(defaults)
  } catch {
    const configPath = getConfigPath()
    if (existsSync(configPath)) {
      writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf-8')
    }
    wasReset = true
    return createStore(defaults)
  }
}

/**
 * 「設定を保存する」がONの場合のみStoreインスタンスを生成する。OFFの場合は生成せず、
 * `sessionState`（メモリ上のプレーンオブジェクト）で代替する（005-native-menu-save-toggle
 * FR-010, FR-011。research.md Decision 1, 3）。
 */
let storeInstance: Store<PersistedStore> | undefined = isPersistenceEnabled()
  ? initStore()
  : undefined

let sessionState: PersistedStore = {
  windowState: { ...defaultWindowState },
  appSettings: { ...defaultAppSettings }
}

/** 起動時にconfig.jsonの破損を検知しデフォルト値へ復旧したかどうか（FR-033） */
export function wasConfigReset(): boolean {
  return wasReset
}

export function getWindowState(): WindowState {
  return storeInstance ? storeInstance.get('windowState') : sessionState.windowState
}

export function setWindowState(state: WindowState): void {
  if (storeInstance) {
    storeInstance.set('windowState', state)
  } else {
    sessionState.windowState = state
  }
}

/** WindowStateの一部フィールドのみを既存値とマージして永続化する（T038） */
export function updateWindowState(partial: Partial<WindowState>): void {
  setWindowState({ ...getWindowState(), ...partial })
}

export function getAppSettings(): AppSettings {
  return storeInstance ? storeInstance.get('appSettings') : sessionState.appSettings
}

export function setAppSettings(settings: AppSettings): void {
  if (storeInstance) {
    storeInstance.set('appSettings', settings)
  } else {
    sessionState.appSettings = settings
  }
}

/**
 * 「設定を保存する」をOFF→ONへ切り替える。現在のセッション状態を`defaults`として
 * Storeインスタンスを生成する（コンストラクタ自体が保存先フォルダ・ファイルを作成する
 * 副作用を持つ、research.md Decision 1）。失敗時はfalseを返し、OFFのまま維持する
 * （005-native-menu-save-toggle FR-008, FR-012）。
 */
export function enablePersistence(): boolean {
  if (storeInstance) {
    return true
  }
  try {
    storeInstance = createStore({
      windowState: sessionState.windowState,
      appSettings: sessionState.appSettings
    })
    return true
  } catch {
    storeInstance = undefined
    return false
  }
}

/**
 * 「設定を保存する」をON→OFFへ切り替える。Storeの現在値をセッション状態へコピーした
 * うえでconfig.jsonファイルを削除する。削除に失敗した場合はONのまま維持し、セッション状態への
 * コピーも行わない（005-native-menu-save-toggle FR-009, FR-012）。
 *
 * 削除対象はconfig.jsonファイル単体とし、保存先フォルダ（`app.getPath('userData')`）自体は
 * 削除しない。このフォルダにはChromiumが実行中に開いたままにするキャッシュ等
 * （Cache/GPUCache/Local Storage等）が含まれており、実行中にフォルダごと再帰削除しようとすると
 * それらのファイルロックによりWindows上で削除が失敗するため（実機検証により判明）。
 */
export function disablePersistence(): boolean {
  if (!storeInstance) {
    return true
  }
  const snapshot: PersistedStore = {
    windowState: storeInstance.get('windowState'),
    appSettings: storeInstance.get('appSettings')
  }
  try {
    rmSync(getConfigPath(), { force: true })
  } catch {
    return false
  }
  sessionState = snapshot
  storeInstance = undefined
  return true
}
