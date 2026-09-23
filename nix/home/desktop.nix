{ lib, pkgs, ... }:
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
  sessionMenu = pkgs.writeShellApplication {
    name = "desktop-session-menu";
    runtimeInputs = [
      pkgs.fuzzel
      pkgs.systemd
      pkgs.uwsm
    ];
    text = ''
      choice=$(printf 'Lock\nLog out\nRestart\nShut down\n' | fuzzel --dmenu --prompt='Session: ') || exit 0
      case "$choice" in
        Lock) loginctl lock-session ;;
        'Log out') uwsm stop ;;
        Restart) systemctl reboot ;;
        'Shut down') systemctl poweroff ;;
      esac
    '';
  };
in
{
  home.packages = [
    pkgs.mako
    pkgs.hypridle
    pkgs.gnome-keyring
    pkgs.libsecret
    screenshot
    sessionMenu
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
      hl.config({
        general = {
          gaps_in = 6, gaps_out = 12, border_size = 2, layout = "dwindle",
          col = {
            active_border = "rgb(${hex roles.accent-secondary})",
            inactive_border = "rgb(${hex roles.divider-subtle})",
          },
        },
        decoration = { rounding = 8, blur = { enabled = false }, shadow = { enabled = false } },
        animations = { enabled = true },
        input = { kb_layout = "us", follow_mouse = 0 },
        misc = {
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
      hl.bind("SUPER + B", launch("firefox"))
      hl.bind("SUPER + Q", hl.dsp.window.close())
      hl.bind("SUPER + F", hl.dsp.window.fullscreen())
      hl.bind("SUPER + SHIFT + Space", hl.dsp.window.float({ action = "toggle" }))
      hl.bind("SUPER + CTRL + L", hl.dsp.exec_cmd("loginctl lock-session"))
      hl.bind("SUPER + SHIFT + Escape", launch("desktop-session-menu"))
      hl.bind("Print", launch("screenshot-region"))

      for key, direction in pairs({ H = "left", J = "down", K = "up", L = "right" }) do
        hl.bind("SUPER + " .. key, hl.dsp.focus({ direction = direction }))
      end
      for i = 1, 9 do
        hl.bind("SUPER + " .. i, hl.dsp.focus({ workspace = i }))
        hl.bind("SUPER + SHIFT + " .. i, hl.dsp.window.move({ workspace = i }))
      end
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
    listener {
      timeout = 600
      on-timeout = loginctl lock-session
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
    systemd.enable = false;
    settings.main = {
      layer = "top";
      position = "top";
      height = 34;
      spacing = 6;
      modules-left = [
        "custom/menu"
        "hyprland/workspaces"
        "wlr/taskbar"
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
        format = "{name}";
        on-click = "activate";
        disable-scroll = true;
      };
      "wlr/taskbar" = {
        format = "{icon}";
        icon-size = 20;
        tooltip-format = "{title}";
        on-click = "activate";
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
      #workspaces button.active, #taskbar button.active {
        color: ${roles.accent-secondary}; background: ${roles.surface-highlight};
      }
      #workspaces button.urgent { color: ${roles.accent-primary}; }
      #custom-menu, #custom-session { padding: 0 10px; color: ${roles.accent-secondary}; }
      #clock, #network, #bluetooth, #pulseaudio, #tray { padding: 0 6px; }
      #network.disconnected, #pulseaudio.muted { color: ${roles.text-ui}; }
      tooltip { background: ${roles.surface-chrome}; color: ${roles.text}; }
    '';
  };
}
