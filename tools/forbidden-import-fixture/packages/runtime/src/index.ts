// no-react-in-core-or-runtime: even a type-only import counts.
export type { ReactNode } from "react";
// runtime-imports-core-only: runtime reaches into renderer.
import "../../renderer/src/index";
