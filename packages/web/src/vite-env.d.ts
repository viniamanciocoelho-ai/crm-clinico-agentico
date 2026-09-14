/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base da API REST. Padrão `/api`, reescrito pelo proxy do Vite em dev. */
  readonly VITE_API_URL?: string;
  /**
   * `"true"` habilita os recursos de demonstração (dados sintéticos do tenant
   * de demo e troca direta de perfil). Exposta ao bundle via `envPrefix` no
   * `vite.config.ts`; qualquer outro valor — ou a ausência dela — significa
   * produção.
   */
  readonly DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
