{ config, inputs, lib, pkgs, ... }:
let
  # Guidance is live-editable; extensions and their dependencies stay packaged.
  liveResource = name: config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.dotfiles/pi-config/agent/${name}";
  system = pkgs.stdenv.hostPlatform.system;
  piPkgs = import inputs.nixpkgs-pi {
    inherit system;
    config.allowUnfree = true;
  };
  extensions = pkgs.callPackage ../packages/pi-extensions.nix { };
  runtimePackages = pkgs.callPackage ../packages/pi-runtime.nix { };
  piLens = pkgs.callPackage ../packages/pi-lens.nix { };
  piBtw = pkgs.callPackage ../packages/pi-btw.nix { };
  sourceSettings = builtins.fromJSON (builtins.readFile ../../pi-config/agent/settings.json);
  linuxSettings = sourceSettings // {
    lastChangelogVersion = piPkgs.pi-coding-agent.version;
    packages = [
      "npm:pi-ast-grep@0.1.0"
      "npm:pi-mcp-adapter@2.36.0"
      { source = "${piLens}"; skills = [ ]; }
      { source = "${piBtw}"; skills = [ ]; }
    ];
  };
in
{
  home.packages = [ piPkgs.pi-coding-agent ];
  home.sessionVariables = {
    PI_CODING_AGENT_DIR = "$HOME/.config/pi-config/agent";
    PI_FFF_MODE = "override";
    PI_BTW_FOCUS_KEYS = "alt+/";
    PI_BTW_WIDTH_KEY = "alt+shift+/";
    PI_LENS_CONFIG_PATH = "$HOME/.config/pi-config/agent/extensions/pi-lens.json";
    PI_LENS_HOME = "$HOME/.local/state/pi-lens";
    PI_LENS_DISABLE_LSP_INSTALL = "1";
    PI_LENS_DISABLE_TOOL_INSTALL = "1";
    PI_LENS_DISABLE_TOOL_REFRESH = "1";
    PI_LENS_DISABLE_MUTATIONS = "1";
    PI_LENS_NO_CONTEXT_INJECTION = "1";
  };

  xdg.configFile = {
    "pi-config/agent/AGENTS.md".source = liveResource "AGENTS.md";
    "pi-config/agent/agents".source = liveResource "agents";
    "pi-config/agent/extensions" = { source = extensions; recursive = true; };
    "pi-config/agent/prompts".source = liveResource "prompts";
    "pi-config/agent/skills".source = liveResource "skills";
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
