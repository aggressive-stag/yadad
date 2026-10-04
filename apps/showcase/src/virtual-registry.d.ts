// Provided by the yadad-registry plugin in vite.config.ts.
declare module "virtual:yadad-registry" {
  import type { Registry } from "@yadad/core";
  import type { ReactNode } from "react";

  export const registry: Registry<ReactNode>;
}
