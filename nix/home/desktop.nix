{ config, lib, pkgs, ... }:
let
  palette = import ./palette.nix { inherit lib; };
  inherit (palette) roles hex;
  screenshot = pkgs.writeShellApplication {
    name = "screenshot-region";
    runtimeInputs = [
      pkgs.grim
      pkgs.slurp
      pkgs.wl-clipboard
    ];
    text = ''
      geometry=$(slurp) || exit 0
      grim -g "$geometry" - | wl-copy --type image/png
    '';
  };
  appFocus = pkgs.writeScriptBin "app-focus" ''
    #!${pkgs.python3}/bin/python3
    ${builtins.readFile ./app-focus.py}
  '';
  sessionMenu = pkgs.writeShellApplication {
    name = "desktop-session-menu";
    runtimeInputs = [
      pkgs.fuzzel
      pkgs.systemd
      pkgs.uwsm
    ];
    text = ''
      choice=$(printf 'Lock\nSleep\nLog out\nRestart\nShut down\n' | fuzzel --dmenu --prompt='Session: ') || exit 0
      case "$choice" in
        Lock) loginctl lock-session ;;
        Sleep) systemctl suspend ;;
        'Log out') uwsm stop ;;
        Restart) systemctl reboot ;;
        'Shut down') systemctl poweroff ;;
      esac
    '';
  };
in
{
  imports = [ ./dock.nix ];

  # Hyprland does not select KDE's platform theme automatically. Without it,
  # Dolphin's item labels retain Qt's black text despite its dark KDE view.
  qt = {
    enable = true;
    platformTheme.name = "kde";
  };

  home.packages = [
    pkgs.mako
    pkgs.hypridle
    pkgs.gnome-keyring
    pkgs.libsecret
    screenshot
    sessionMenu
    appFocus
  ];

  wayland.windowManager.hyprland = {
    enable = true;
    package = null;
    portalPackage = null;
    configType = "lua";
    # UWSM owns environment and session lifetime. Do not start a second target.
    systemd.enable = false;
    extraConfig = ''
      hl.monitor({ output = "", mode = "preferred", position = "auto", scale = "auto" })
      hl.monitor({ output = "DP-1", mode = "2560x1440@179.98", position = "0x0", scale = 1 })
      hl.monitor({ output = "DP-2", mode = "2560x1440@180", position = "2560x0", scale = 1 })
      hl.config({
        general = {
          gaps_in = 6, gaps_out = 12, border_size = 2, layout = "dwindle",
          col = {
            active_border = "rgb(${hex roles.accent-secondary})",
            inactive_border = "rgb(${hex roles.divider-subtle})",
          },
        },
        decoration = { rounding = 8, blur = { enabled = false }, shadow = { enabled = false } },
        animations = { enabled = true, workspace_wraparound = false },
        input = { kb_layout = "us", follow_mouse = 0, repeat_rate = 50, repeat_delay = 250 },
        misc = {
          vrr = 2, -- Adaptive sync only while a fullscreen window is present.
          disable_hyprland_logo = true,
          disable_splash_rendering = true,
          force_default_wallpaper = 0,
        },
      })

      hl.curve("desktopEase", {
        type = "bezier",
        points = { { 0.2, 0.8 }, { 0.2, 1.0 } },
      })
      hl.animation({ leaf = "windows", enabled = true, speed = 2, bezier = "desktopEase", style = "popin 95%" })
      hl.animation({ leaf = "windowsMove", enabled = true, speed = 1.5, bezier = "desktopEase" })
      hl.animation({ leaf = "fade", enabled = true, speed = 1.5, bezier = "desktopEase" })
      hl.animation({ leaf = "workspaces", enabled = true, speed = 2.5, bezier = "desktopEase", style = "slide" })

      local function launch(command) return hl.dsp.exec_cmd("uwsm app -- " .. command) end
      hl.bind("SUPER + Return", launch("ghostty"))
      hl.bind("SUPER + Space", launch("fuzzel"))
      hl.bind("SUPER + E", launch("dolphin"))
      hl.bind("SUPER + B", launch("helium"))
      for key, app in pairs({ A = "helium", Z = "ghostty", S = "dolphin", X = "obsidian" }) do
        hl.bind("SUPER + CTRL + " .. key, hl.dsp.exec_cmd("app-focus " .. app))
      end
      hl.bind("SUPER + Q", hl.dsp.window.close())
      hl.bind("SUPER + F", hl.dsp.window.fullscreen())
      hl.bind("SUPER + SHIFT + Space", hl.dsp.window.float({ action = "toggle" }))
      hl.bind("SUPER + CTRL + L", hl.dsp.exec_cmd("loginctl lock-session"))
      hl.bind("SUPER + SHIFT + Escape", launch("desktop-session-menu"))
      hl.bind("Print", launch("screenshot-region"))

      for key, direction in pairs({ H = "left", J = "down", K = "up", L = "right" }) do
        hl.bind("SUPER + " .. key, hl.dsp.focus({ direction = direction }))
      end
      ${builtins.readFile ./workspaces.lua}
      ${builtins.readFile ./scratch-terminal.lua}
      ${builtins.readFile ./scratch-sidra.lua}
      hl.bind("SUPER + mouse:272", hl.dsp.window.drag(), { mouse = true })
      hl.bind("SUPER + mouse:273", hl.dsp.window.resize(), { mouse = true })
      hl.bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 5%+"), { locked = true, repeating = true })
      hl.bind("XF86AudioLowerVolume", hl.dsp.exec_cmd("wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-"), { locked = true, repeating = true })
      hl.bind("XF86AudioMute", hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"), { locked = true })
      hl.bind("XF86AudioPlay", hl.dsp.exec_cmd("playerctl play-pause"), { locked = true })
      hl.bind("XF86AudioNext", hl.dsp.exec_cmd("playerctl next"), { locked = true })
      hl.bind("XF86AudioPrev", hl.dsp.exec_cmd("playerctl previous"), { locked = true })

      -- Only this session starts these daemons; Plasma keeps its own equivalents.
      hl.on("hyprland.start", function()
        hl.exec_cmd("uwsm finalize")
        hl.exec_cmd("uwsm app -- waybar")
        -- One moving dock; -hd 0 reveals it even on slow bottom-edge approaches.
        hl.exec_cmd("uwsm app -- nwg-dock-hyprland -d -p bottom -a center -i 40 -mb 8 -hd 0 -nolauncher")
        hl.exec_cmd("uwsm app -s b -- mako")
        hl.exec_cmd("uwsm app -s b -- hypridle")
        -- Hyprland gets a Secret Service provider without replacing Plasma's wallet.
        hl.exec_cmd("uwsm app -s b -- ${pkgs.gnome-keyring}/bin/gnome-keyring-daemon --start --components=secrets")
        hl.exec_cmd("uwsm app -s b -- ${pkgs.kdePackages.polkit-kde-agent-1}/libexec/polkit-kde-authentication-agent-1")
      end)
    '';
  };

  programs.fuzzel = {
    enable = true;
    settings = {
      main = {
        font = "Lilex Nerd Font:size=12";
        terminal = "ghostty -e";
        launch-prefix = "uwsm app --";
        icon-theme = config.gtk.iconTheme.name;
      };
      colors = {
        background = "${hex roles.surface-chrome}ff";
        text = "${hex roles.text}ff";
        match = "${hex roles.accent-primary}ff";
        selection = "${hex roles.surface-highlight}ff";
        selection-text = "${hex roles.text}ff";
        selection-match = "${hex roles.accent-primary}ff";
        border = "${hex roles.accent-secondary}ff";
      };
    };
  };

  programs.hyprlock = {
    enable = true;
    settings = {
      background = [
        {
          monitor = "";
          color = "rgb(${hex roles.canvas})";
        }
      ];
      input-field = [
        {
          monitor = "";
          size = "320, 60";
          position = "0, -40";
          halign = "center";
          valign = "center";
          inner_color = "rgb(${hex roles.surface-chrome})";
          outer_color = "rgb(${hex roles.accent-secondary})";
          font_color = "rgb(${hex roles.text})";
          placeholder_text = "Password";
        }
      ];
    };
  };
  xdg.configFile."hypr/hypridle.conf".text = ''
    general {
      lock_cmd = pidof hyprlock || hyprlock
      before_sleep_cmd = loginctl lock-session
    }
  '';
  xdg.configFile."mako/config".text = ''
    font=Lilex Nerd Font 11
    background-color=${roles.surface-chrome}
    text-color=${roles.text}
    border-color=${roles.accent-secondary}
    border-size=2
    border-radius=8
    default-timeout=5000
    [urgency=critical]
    default-timeout=0
    border-color=${roles.accent-primary}
  '';

  programs.waybar = {
    enable = true;
    package = pkgs.waybar.overrideAttrs (old: {
      patches = (old.patches or [ ]) ++ [
        ../packages/waybar-grayscale.patch
        ../packages/waybar-hyprland-lua.patch
      ];
      nativeBuildInputs = (old.nativeBuildInputs or [ ]) ++ [ pkgs.lua ];
      postBuild = (old.postBuild or "") + ''
        $CXX $(pkg-config --cflags gtkmm-3.0) -I../include \
          ${../packages/waybar-grayscale-test.cpp} \
          $(pkg-config --libs gtkmm-3.0) -o grayscale-icon-test
        ./grayscale-icon-test
        $CXX -std=c++17 -I../include ${../packages/waybar-hyprland-lua-test.cpp} -o lua-dispatch-test
        ./lua-dispatch-test > lua-dispatch-test.lua
        lua lua-dispatch-test.lua
      '';
    });
    systemd.enable = false;
    settings.main = {
      layer = "top";
      position = "top";
      height = 34;
      spacing = 6;
      modules-left = [
        "custom/menu"
        "hyprland/workspaces"
      ];
      modules-center = [ "clock" ];
      modules-right = [
        "pulseaudio"
        "network"
        "bluetooth"
        "tray"
        "custom/session"
      ];
      "custom/menu" = {
        format = "Apps";
        on-click = "fuzzel";
        tooltip = false;
      };
      "hyprland/workspaces" = {
        format = "{icon} {windows}";
        workspace-taskbar = {
          enable = true;
          format = "{icon}";
          icon-size = 20;
          icon-theme = config.gtk.iconTheme.name;
          update-active-window = true;
          active-window-position = "none";
          # Only the address/button supplied by Waybar enters this command.
          on-click-window = "if [ {button} = 1 ]; then hyprctl dispatch \"hl.dsp.focus({ window = 'address:{address}' })\"; fi";
        };
        format-icons = builtins.listToAttrs (
          lib.concatMap (i: [
            { name = toString (100 + i); value = "${toString i}*"; }
            { name = toString (200 + i); value = "${toString i}^"; }
          ]) (lib.range 1 9)
        );
        disable-scroll = true;
        all-outputs = false;
        move-to-monitor = false;
        sort-by = "id";
        # Show only existing (populated or active) workspaces on this output.
        # Unmapped legacy names retain their labels; do not create placeholders.
      };
      clock = {
        format = "{:%a %d %b  %H:%M}";
        tooltip-format = "{:%Y-%m-%d}";
      };
      pulseaudio = {
        format = "Vol {volume}%";
        format-muted = "Muted";
        on-click = "uwsm app -- pavucontrol";
      };
      network = {
        format-wifi = "Wi-Fi";
        format-ethernet = "Wired";
        format-disconnected = "Offline";
        tooltip-format = "{ifname}: {ipaddr}";
        on-click = "uwsm app -- nm-connection-editor";
      };
      bluetooth = {
        format = "BT {status}";
        format-connected = "BT {num_connections}";
        on-click = "uwsm app -- blueman-manager";
      };
      tray = {
        icon-size = 18;
        spacing = 6;
      };
      "custom/session" = {
        format = "Session";
        on-click = "desktop-session-menu";
        tooltip = false;
      };
    };
    style = ''
      * { font-family: "Lilex Nerd Font", sans-serif; font-size: 13px; border: none; }
      window#waybar { background: ${roles.surface-chrome}; color: ${roles.text}; }
      button { color: ${roles.text-ui}; border-radius: 4px; padding: 0 8px; }
      button:hover { background: ${roles.surface-highlight}; }
      #workspaces button { margin: 0 3px; }
      #workspaces button.active {
        color: ${roles.accent-secondary}; background: ${roles.surface-highlight};
      }
      #workspaces button.urgent { color: ${roles.accent-primary}; }
      #workspaces .taskbar-window { padding: 0 5px 6px; border-radius: 4px; }
      #workspaces .taskbar-window:hover { background: ${roles.surface-highlight}; }
      #workspaces .taskbar-window.active {
        background-image: radial-gradient(circle, ${roles.accent-secondary} 2px, transparent 2px);
        background-size: 4px 4px;
        background-repeat: no-repeat;
        background-position: center bottom;
      }
      #custom-menu, #custom-session { padding: 0 10px; color: ${roles.accent-secondary}; }
      #clock, #network, #bluetooth, #pulseaudio, #tray { padding: 0 6px; }
      #network.disconnected, #pulseaudio.muted { color: ${roles.text-ui}; }
      tooltip { background: ${roles.surface-chrome}; color: ${roles.text}; }
    '';
  };
}
