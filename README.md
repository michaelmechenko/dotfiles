## my dotfiles

many changes, will update soon

### things

#### macos

wm: aerospace (todo: describe features)

floating window management: rectangle pro

shell: zsh

tmux: yes (todo: describe features)

prompt: ohmyposh

editor: nvim (todo: add plugins)

terminal: ghostty

top bar: sketchybar

borders: jankyborders

colorscheme: theme system (`theme switch vague|oldworld`, see theme/SUPPORT.md)

font: lilex

keybindings and app switching: raycast

cool tools and things used:
- worktrunk (`wt`) for isolated worktree workflows
- opencode
- k9s
- orbstack
- betterdisplay
- eza
- lazygit
- lazydocker

#### nixos

The Linux desktop bootstrap lives in [`flake.nix`](flake.nix) and [`nix/`](nix/README.md).
It preserves the installed Plasma fallback and adds Hyprland/UWSM, a clickable
Waybar, desktop applications, and Linux-adapted versions of the shared terminal,
Neovim, tmux/sidebar, and Pi workflows. See `nix/README.md` for deployment,
activation, recovery, mutable-state boundaries, and acceptance tests. It does not
change the macOS behavior.
