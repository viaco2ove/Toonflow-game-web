/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly __APP_VERSION__: string
  // 或者 readonly VITE_APP_VERSION: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}