import type { TabBarApi } from './tab-bar-preload'
import type { SidebarTocApi } from './sidebar-toc-preload'
import type { SearchFloatApi } from './search-float-preload'
import type { ContentApi } from './content-preload'

declare global {
  interface Window {
    tabBarApi: TabBarApi
    sidebarTocApi: SidebarTocApi
    searchFloatApi: SearchFloatApi
    contentApi: ContentApi
  }
}
