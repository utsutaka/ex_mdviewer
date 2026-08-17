import githubDarkStylesUrl from 'highlight.js/styles/github-dark.css?url'
import githubLightStylesUrl from 'highlight.js/styles/github.css?url'
import type { Theme } from '@shared/types'

let currentTheme: Theme = 'light'
const listeners = new Set<(theme: Theme) => void>()

export function getTheme(): Theme {
  return currentTheme
}

const HLJS_LINK_ID = 'hljs-theme-stylesheet'

function applyHighlightJsTheme(theme: Theme): void {
  let link = document.getElementById(HLJS_LINK_ID) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = HLJS_LINK_ID
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  link.href = theme === 'dark' ? githubDarkStylesUrl : githubLightStylesUrl
}

function applyThemeClass(theme: Theme): void {
  document.documentElement.classList.remove('theme-light', 'theme-dark')
  document.documentElement.classList.add(`theme-${theme}`)
  applyHighlightJsTheme(theme)
}

/** ダーク/ライトテーマを切り替え、AppSettingsへ永続化する（FR-009。OS設定への自動追従はしない） */
export function setTheme(theme: Theme): void {
  currentTheme = theme
  applyThemeClass(theme)
  window.api.themeChanged(theme)
  listeners.forEach((listener) => listener(theme))
}

/** 起動時、永続化済みのテーマを適用する（IPC送出は行わない） */
export function initTheme(initialTheme: Theme): void {
  currentTheme = initialTheme
  applyThemeClass(initialTheme)
}

export function onThemeChange(listener: (theme: Theme) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
