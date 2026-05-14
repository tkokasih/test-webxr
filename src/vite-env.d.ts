/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_BRANCH: string;
  readonly VITE_BUILD_SHA: string;
  readonly VITE_BUILD_TIMESTAMP: string;
  readonly VITE_GITHUB_REPOSITORY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
