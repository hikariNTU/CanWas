/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/** Inlined by `define` in vite.config.ts. */
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;
declare const __ORT_VERSION__: string;

interface ImportMetaEnv {
  /**
   * The OAuth client id for Drive sync. Not a secret — it identifies the app,
   * and Google enforces which origins may present it. Absent in a build that
   * has not been configured, which the UI reports rather than hiding.
   */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
