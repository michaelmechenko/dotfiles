{ buildNpmPackage }:
buildNpmPackage {
  pname = "pi-linux-packages";
  version = "1.0.0";
  src = ./pi-runtime;
  npmDepsHash = "sha256-kW5ixzLMCxSs5tS0Bb1Wn8YwAhR4AmagLzRbtRlZ5GM=";
  npmFlags = [ "--legacy-peer-deps" ];
  npmInstallFlags = [ "--ignore-scripts" ];
  dontNpmBuild = true;
  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -r package.json package-lock.json node_modules "$out/"
    runHook postInstall
  '';
}
