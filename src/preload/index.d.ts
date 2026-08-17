import type { MdviewerApi } from './index'

declare global {
  interface Window {
    api: MdviewerApi
  }
}
