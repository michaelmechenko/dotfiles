// Discovery shim. pi's directory auto-discovery looks for a top-level index.ts;
// the real entry point is src/index.ts. No package.json `pi.extensions` manifest
// here so the resolver falls through to this shim and labels the extension
// `claude-bridge` (see pi-config/README.md, skill-toggle bullet).
export { default } from "./src/index.ts";
