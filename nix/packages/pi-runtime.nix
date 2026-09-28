{ buildNpmPackage }:
buildNpmPackage {
  pname = "pi-linux-packages";
  version = "1.0.0";
  src = ./pi-runtime;
  npmDepsHash = "sha256-pM1gsQeNiQvxnKyzd91RYVyLyjiXYMIsCR6AWh1R6zA=";
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
