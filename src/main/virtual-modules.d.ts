/** electron.vite.config.tsのbuild-version-pluginが提供する仮想モジュールの型宣言 */
declare module 'virtual:build-version' {
  export const BUILD_VERSION: string
}
