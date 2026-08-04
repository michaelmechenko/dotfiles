// Forked locally from https://github.com/heyhuynhgiabuu/pi-pretty (@heyhuynhgiabuu/pi-pretty).
// Top-level shim for pi's `extensions/<name>/index.ts` auto-discovery — see the
// `skill-toggle/` precedent in pi-config/README.md for why this can't just be a
// `package.json` "pi.extensions" manifest pointing at a built dist/ path.
export { default } from "./src/index.ts";
export type { PiPrettyDeps } from "./src/index.ts";
