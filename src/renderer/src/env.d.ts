/// <reference types="vite/client" />
import type { QingxiangApi } from '../../shared/types'

declare global {
  interface Window {
    qx: QingxiangApi
  }
}
