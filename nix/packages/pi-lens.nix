{ buildNpmPackage, fetchFromGitHub, fetchurl, lib }:
let
  grammarSources = map
    (grammar: grammar // { src = fetchurl { inherit (grammar) url hash; }; })
    [
      { name = "tree-sitter-typescript.wasm"; url = "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-typescript.wasm"; hash = "sha256-hRVATc7tOOHthqo0sJ/PM3n/8bT/ndOWe81tHrWsPY8="; package = "tree-sitter-wasms"; version = "0.1.13"; }
      { name = "tree-sitter-tsx.wasm"; url = "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-tsx.wasm"; hash = "sha256-aqOyxw529dSOr+8Qk+nE3jg+E/L93i9Om5ijePao8bY="; package = "tree-sitter-wasms"; version = "0.1.13"; }
      { name = "tree-sitter-javascript.wasm"; url = "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-javascript.wasm"; hash = "sha256-Y4ErniddJoUSZHNIaNJ6Fla9RKLvbrPoXmsDcoxZWrU="; package = "tree-sitter-wasms"; version = "0.1.13"; }
      { name = "tree-sitter-python.wasm"; url = "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-python.wasm"; hash = "sha256-kFbQ+wwzeBDQGfrjUOgWd4YRnamPDygqzq56uJ7oJTs="; package = "tree-sitter-wasms"; version = "0.1.13"; }
      { name = "tree-sitter-go.wasm"; url = "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-go.wasm"; hash = "sha256-mWPKibYW6vBLCKQ7wfsPB7hTlb7DEzMIUfHx6tL3VbY="; package = "tree-sitter-wasms"; version = "0.1.13"; }
      { name = "tree-sitter-rust.wasm"; url = "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-rust.wasm"; hash = "sha256-RAmSGnDQqlvsfR186AmlV6juHPas6QHjrGp25iz+qQM="; package = "tree-sitter-wasms"; version = "0.1.13"; }
      { name = "tree-sitter-json.wasm"; url = "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-json.wasm"; hash = "sha256-/bUhmr4Fg2nhaJeqoR7s9H709UZ1LD3brDOc3Ynh5mc="; package = "tree-sitter-wasms"; version = "0.1.13"; }
      { name = "tree-sitter-yaml.wasm"; url = "https://unpkg.com/@tree-sitter-grammars/tree-sitter-yaml@0.7.1/tree-sitter-yaml.wasm"; hash = "sha256-51LcIcNZHfm0VpL+QX0QH0XRgowoxE15AF9AZtx+TpE="; package = "@tree-sitter-grammars/tree-sitter-yaml"; version = "0.7.1"; }
      { name = "tree-sitter-bash.wasm"; url = "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-bash.wasm"; hash = "sha256-gH3NsTgKWb77ES7Y+9PThyx/ra9ZA6dpKCtQlzswaW0="; package = "tree-sitter-wasms"; version = "0.1.13"; }
      { name = "tree-sitter-html.wasm"; url = "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-html.wasm"; hash = "sha256-EbNAXBVD+wEvXtf47nMSUHbc6LFoMB4eeH5McX2mtFY="; package = "tree-sitter-wasms"; version = "0.1.13"; }
      { name = "tree-sitter-css.wasm"; url = "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-css.wasm"; hash = "sha256-X8YVRnsbmEIO11F+W/nh+IRoEy3ZA9hC37E3FPahyww="; package = "tree-sitter-wasms"; version = "0.1.13"; }
      { name = "tree-sitter-java.wasm"; url = "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-java.wasm"; hash = "sha256-Y3qsRBX7OaIRpPQpLWPGa1zpwy+izTVGSvT2gdkbmh8="; package = "tree-sitter-wasms"; version = "0.1.13"; }
    ];
  copyGrammar = grammar: ''
    cp ${grammar.src} "grammars/${grammar.name}"
    actual_hash="$(sha256sum ${grammar.src} | cut -d' ' -f1)"
    cat > "grammars/${grammar.name}.json" <<JSON
    {"npmPackage":"${grammar.package}","version":"${grammar.version}","sha256":"sha256:$actual_hash"}
    JSON
  '';
in
buildNpmPackage {
  pname = "pi-lens";
  version = "4.3.0-unstable-2026-09-28";
  src = fetchFromGitHub {
    owner = "michaelmechenko";
    repo = "pi-lens";
    rev = "5e27080a3855dba5a2263f7e3b043e8d7385c3a5";
    hash = "sha256-Xvpo9iXSPNWIMuTPphCVKzjNm7Sx1VA3OyFF3U+Uaew=";
  };
  npmDepsFetcherVersion = 2;
  npmDepsHash = "sha256-EjRnTyNttQUtTzn3wizZ2THeMzlliJns+aGDV4wdHNk=";
  npmFlags = [ "--legacy-peer-deps" ];
  npmInstallFlags = [ "--ignore-scripts" ];
  npmBuildScript = "build:dist";
  preBuild = ''
    mkdir -p grammars
    ${lib.concatMapStringsSep "\n" copyGrammar grammarSources}
  '';
  installPhase = ''
    runHook preInstall
    npm prune --omit=dev --omit=peer --ignore-scripts --legacy-peer-deps --offline
    mkdir -p "$out"
    cp -r package.json dist grammars vendor config rules skills scripts docs README.md CHANGELOG.md banner.svg banner.png node_modules "$out/"
    runHook postInstall
  '';
}
