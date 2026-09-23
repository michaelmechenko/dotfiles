{ buildNpmPackage }:
buildNpmPackage {
  pname = "pi-linux-packages";
  version = "1.0.0";
  src = ./pi-runtime;
  npmDepsHash = "sha256-ixNEWgs68I8zgdNhD+DNSSoYB5C4pOdEekG1JGwHBKQ=";
  npmFlags = [ "--legacy-peer-deps" ];
  npmInstallFlags = [ "--ignore-scripts" ];
  dontNpmBuild = true;
  postConfigure = ''
    substituteInPlace node_modules/@dreki-gg/pi-lsp/extensions/lsp/config.ts \
      --replace-fail "return join(home, '.pi', 'agent', 'extensions', 'lsp', 'config.json');" \
      "return process.env.PI_CODING_AGENT_DIR ? join(process.env.PI_CODING_AGENT_DIR, 'extensions', 'lsp', 'config.json') : join(home, '.pi', 'agent', 'extensions', 'lsp', 'config.json');"
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -r package.json package-lock.json node_modules "$out/"
    runHook postInstall
  '';
}
