import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { buildVersionPlugin } from './scripts/vite-plugins/build-version-plugin'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    plugins: [externalizeDepsPlugin(), buildVersionPlugin()]
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // 033-webcontentsview-search-fix: rollupOptions.inputのキー名がそのまま出力
        // ファイル名（<キー>.js）になるため、window.tsが参照するファイル名と一致させる
        input: {
          'tab-bar-preload': resolve('src/preload/tab-bar-preload.ts'),
          'sidebar-toc-preload': resolve('src/preload/sidebar-toc-preload.ts'),
          'search-float-preload': resolve('src/preload/search-float-preload.ts'),
          'content-preload': resolve('src/preload/content-preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          splash: resolve('src/renderer/splash.html'),
          tabBar: resolve('src/renderer/tab-bar/index.html'),
          sidebarToc: resolve('src/renderer/sidebar-toc/index.html'),
          searchFloat: resolve('src/renderer/search-float/index.html'),
          content: resolve('src/renderer/content/index.html')
        }
      }
    }
  }
})
