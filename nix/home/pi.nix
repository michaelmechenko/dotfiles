{ inputs, lib, pkgs, ... }:
let
  system = pkgs.stdenv.hostPlatform.system;
  piPkgs = import inputs.nixpkgs-pi {
    inherit system;
    config.allowUnfree = true;
  };
  extensions = pkgs.callPackage ../packages/pi-extensions.nix { };
  runtimePackages = pkgs.callPackage ../packages/pi-runtime.nix { };
  sourceSettings = builtins.fromJSON (builtins.readFile ../../pi-config/agent/settings.json);
  linuxSettings = sourceSettings // {
    lastChangelogVersion = piPkgs.pi-coding-agent.version;
    packages = [
      "npm:@dreki-gg/pi-lsp@0.5.2"
      "npm:pi-ast-grep@0.1.0"
      "npm:pi-mcp-adapter@2.36.0"
    ];
  };
in
{
  home.packages = [ piPkgs.pi-coding-agent ];
  home.sessionVariables = {
    PI_CODING_AGENT_DIR = "$HOME/.config/pi-config/agent";
    PI_FFF_MODE = "override";
  };

  xdg.configFile = {
    "pi-config/agent/AGENTS.md".source = ../../pi-config/agent/AGENTS.md;
    "pi-config/agent/agents" = { source = ../../pi-config/agent/agents; recursive = true; };
    "pi-config/agent/extensions" = { source = extensions; recursive = true; };
    "pi-config/agent/prompts" = { source = ../../pi-config/agent/prompts; recursive = true; };
    "pi-config/agent/skills" = { source = ../../pi-config/agent/skills; recursive = true; };
    "pi-config/agent/themes/active.json".source = ../../theme/bundles/vague/pi/theme.json;
  };

  # Pi and the toggle extensions intentionally update these files. Seed them on
  # first activation, then leave user changes writable and outside the Nix store.
  home.activation.seedPiMutableConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    agent="$HOME/.config/pi-config/agent"
    mkdir -p "$agent"
    if [ ! -e "$agent/settings.json" ]; then
      cat > "$agent/settings.json" <<'JSON'
${builtins.toJSON linuxSettings}
JSON
      chmod 600 "$agent/settings.json"
    fi
    if [ ! -e "$agent/keybindings.json" ]; then
      install -m 600 ${../../pi-config/agent/keybindings.json} "$agent/keybindings.json"
    fi
    if [ ! -e "$agent/npm/package-lock.json" ]; then
      mkdir -p "$agent/npm"
      cp -r ${runtimePackages}/. "$agent/npm/"
      chmod -R u+w "$agent/npm"
    fi
  '';
}
