{ config, lib, pkgs, ... }:
let
  sessionTarget = "wayland-session@hyprland.desktop.target";
  palette = import ./palette.nix { inherit lib; };
  inherit (palette) roles;
  appearance = { name = "vague"; icon_theme = config.gtk.iconTheme.name; };
in
{
  programs.vicinae = {
    enable = true;
    systemd = {
      enable = true;
      target = sessionTarget;
    };
    # Keys verified against the pinned Vicinae 0.23.2 config and provider sources.
    settings = {
      telemetry.system_info = false;
      input_server.enabled = false;
      providers = {
        applications.preferences.launchPrefix = "uwsm app --";
        clipboard.preferences.monitoring = false;
      };
      favorites = [ ];
      search_files_in_root = false;
      font.normal = { family = "Lilex Nerd Font"; size = 12; };
      theme = { dark = appearance; light = appearance; };
      launcher_window = {
        opacity = 1;
        material = "none";
        rounding = 8;
        client_side_decorations.shadow_size = 0;
        layer_shell = {
          enabled = true;
          # Exclusive keyboard mode breaks mouse interaction with Hyprland popups.
          keyboard_interactivity = "on_demand";
        };
      };
      close_on_focus_loss = true;
      escape_key_behavior = "close_window";
      pop_to_root_on_close = true;
    };
    themes.vague = {
      meta = {
        name = "Vague";
        description = "Canonical desktop palette";
        variant = "dark";
        inherits = "vicinae-dark";
      };
      colors = {
        core = {
          background = roles.surface-chrome;
          secondary_background = roles.surface-active;
          foreground = roles.text;
          border = roles.divider-subtle;
          accent = roles.accent-secondary;
          accent_foreground = roles.surface-chrome;
        };
        accents = {
          blue = roles.accent-info;
          green = roles.accent-tertiary;
          magenta = roles.accent-tertiary;
          orange = roles.accent-amber;
          red = roles.accent-primary;
          yellow = roles.accent-warn;
          cyan = roles.accent-secondary;
          purple = roles.accent-periwinkle;
        };
        text = {
          muted = roles.text-ui;
          placeholder = roles.text-ui;
          selection = { background = roles.surface-highlight; foreground = roles.text; };
        };
        list.item = {
          hover = {
            background = roles.surface-highlight;
            foreground = roles.text;
            secondary_foreground = roles.text-ui;
          };
          selection = {
            background = roles.surface-highlight;
            foreground = roles.text;
            secondary_background = roles.surface-highlight;
            secondary_foreground = roles.text-ui;
          };
        };
      };
    };
  };

  # Home Manager may attempt service starts on activation outside Hyprland.
  # Requisite checks the target without pulling a compositor session into Plasma.
  systemd.user.services.vicinae.Unit.Requisite = [ sessionTarget ];

  # The upstream refresh deeplink can autostart a server. Refresh only an
  # already-running Hyprland instance; a new server scans apps on startup.
  home.activation.vicinae-refresh-apps = lib.mkForce (
    lib.hm.dag.entryAfter [ "installPackages" ] ''
      if ${pkgs.systemd}/bin/systemctl --user is-active --quiet ${sessionTarget} \
        && ${pkgs.systemd}/bin/systemctl --user is-active --quiet vicinae.service; then
        run --silence ${lib.getExe config.programs.vicinae.package} deeplink vicinae://launch/core/refresh-apps \
          || verboseEcho "Failed to refresh the vicinae app list"
      fi
    ''
  );
}
