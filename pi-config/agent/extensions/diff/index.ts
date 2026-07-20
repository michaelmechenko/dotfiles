// Forked locally from https://github.com/heyhuynhgiabuu/pi-diff (@heyhuynhgiabuu/pi-diff).
// Top-level shim for pi's `extensions/<name>/index.ts` auto-discovery — see the
// `skill-toggle/` precedent in pi-config/README.md for why this can't just be a
// `package.json` "pi.extensions" manifest pointing at a built dist/ path.
export { default, __testing } from "./src/index.js";
