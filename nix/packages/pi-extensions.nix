{ buildNpmPackage, runCommand }:
let
  source = ../../pi-config/agent/extensions;
  withDeps = name: npmDepsHash: buildNpmPackage {
    pname = "pi-extension-${name}";
    version = "0-unstable-2026-09-22";
    src = source + "/${name}";
    inherit npmDepsHash;
    npmFlags = [ "--legacy-peer-deps" ];
    npmInstallFlags = [ "--ignore-scripts" "--omit=dev" "--omit=peer" ];
    dontNpmBuild = true;
    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -r . "$out/"
      runHook postInstall
    '';
  };
  askUser = withDeps "ask-user" "sha256-CN/pvKIwvWswoINOZsc8ffKmnXaoj96FkEH3jGpGI4E=";
  diff = withDeps "diff" "sha256-JYrvIQftjZ95AaEMGuEs4ekijLZvgNJXvhqPTt66Y28=";
  pretty = withDeps "pretty" "sha256-eNUJjtbOCFeVC6ai0/Be7byAjjjsOSzIUPgFTukM6qk=";
  webTools = withDeps "web-tools" "sha256-vlsA+PelwDIbRvxUQILylROhUO8VGszViNXg7b5BJq8=";
in
runCommand "pi-extensions" { } ''
  cp -r ${source} "$out"
  chmod -R u+w "$out"
  for item in ask-user diff pretty web-tools; do rm -rf "$out/$item"; done
  cp -r ${askUser} "$out/ask-user"
  cp -r ${diff} "$out/diff"
  cp -r ${pretty} "$out/pretty"
  cp -r ${webTools} "$out/web-tools"
''
