# If you come from bash you might have to change your $PATH.
export PATH=$HOME/bin:/usr/local/bin:$PATH
export PATH="$HOME/.config/qol_scripts:$PATH"
export XDG_CONFIG_HOME="$HOME/.config"

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# CASE_SENSITIVE="true"
# HYPHEN_INSENSITIVE="true"

# zstyle ':omz:update' mode disabled
# zstyle ':omz:update' mode auto
zstyle ':omz:update' mode reminder

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS="true"

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# COMPLETION_WAITING_DOTS="true"

# DISABLE_UNTRACKED_FILES_DIRTY="true"

# HIST_STAMPS="mm/dd/yyyy"

plugins=(macos zsh-syntax-highlighting zsh-autosuggestions)

source $ZSH/oh-my-zsh.sh

(( ${+ZSH_HIGHLIGHT_STYLES} )) || typeset -A ZSH_HIGHLIGHT_STYLES
ZSH_HIGHLIGHT_STYLES[path]=none
ZSH_HIGHLIGHT_STYLES[path_prefix]=none

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='nvim'
# fi
export EDITOR='nvim'

# Compilation flags
# export ARCHFLAGS="-arch x86_64"

eval "$(fzf --zsh)"

# fzf colors → vague palette (applies to fzcd, tmux-fzf-url, fzf-tab, shell fzf).
# bg/bg+/gutter/preview-bg = -1 (transparent). Left bar indicator via pointer=▌ #8787af.
# Match hierarchy: hl dusty-pink #bb9dbd (other rows), hl+ rose #d8647e bold (current row).
export FZF_DEFAULT_OPTS='--pointer=▌ --color=fg:#656a80,fg+:#bebebe,bg:-1,bg+:-1,hl:#bb9dbd,hl+:#d8647e:bold,gutter:-1,border:#383848,separator:#383848,scrollbar:#383848,preview-fg:#bebebe,preview-bg:-1,preview-border:#383848,preview-scrollbar:#383848,prompt:#aeaed1,pointer:#d8647e,marker:#bb9dbd,spinner:#f3be7c,info:#656a80,header:#656a80,query:#bebedb,disabled:#656a80,label:#656a80'

# Self-heal the per-machine bat cache: custom themes only resolve after `bat cache --build`,
# which is local (not in git). Build once if `vague` isn't registered yet (no-op afterwards).
if command -v bat >/dev/null 2>&1; then
    bat --list-themes 2>/dev/null | grep -qx vague || bat cache --build >/dev/null 2>&1
fi

# preview-tui text-speed knobs: plain bat (no line-number/grid rendering),
# ansi theme (inherits the terminal palette). Image/video previewers left unset
# so those heavy branches never fire.
export NNN_BATSTYLE=numbers 
export NNN_BATTHEME=vague 
# colors via ANSI indices -> inherit the terminal's themed (vague) palette.
export NNN_COLORS='63256325'
export NNN_FCOLORS='060606020005030801050201'
# in-nnn plugin keys (pressed as ;<key>): ;l horizontal split, ;j vertical split,
# ;i send a cd command to the origin pane's prompt
export NNN_PLUG='l:tmux-split-h;j:tmux-split-v;i:cd-origin;p:preview-tui'
export NNN_SPLIT=v
export NNN_SPLITSIZE=60
# use moor if installed
if command -v moor >/dev/null 2>&1; then
    export NNN_PAGER='moor --no-linenumbers --mousemode=scroll --statusbar=plain'
else
    export NNN_PAGER='less -R --mouse --wheel-lines=1 -+F'
fi

alias n="nnn -aH -l 1 -P p"

bindkey "^[[1;3C" forward-word      # Alt+Right
bindkey "^[[1;3D" backward-word     # Alt+Left

# ctrl+e: accept up to the next whitespace of the autosuggestion if present, else end-of-line.
# vi-forward-blank-word splits on whitespace only (forward-word would stop at punctuation
# like `--`); it's in ZSH_AUTOSUGGEST_PARTIAL_ACCEPT_WIDGETS so partial-accept wraps it.
_accept_word_or_eol() {
  if [[ -n $POSTDISPLAY ]]; then
    zle vi-forward-blank-word   # partial-accept to next blank word (POSTDISPLAY = pending suggestion)
  else
    zle end-of-line
  fi
}
zle -N _accept_word_or_eol
bindkey '^e' _accept_word_or_eol

# ctrl+tab -> accept the whole autosuggestion line.
# Ghostty maps ctrl+tab to F13 (ESC[25~). Bare terminal delivers ^[[25~; through tmux,
# tmux re-encodes the function key via its terminfo and delivers ^[[1;2R instead, so bind both.
bindkey '^[[25~'  end-of-line
bindkey '^[[1;2R' end-of-line

alias ls="eza -1"
alias o="ofd ."
# alias lsl="eza"
# alias cat="bat"
alias e="nvim"
alias ej="nvim tmp.json"
alias em="nvim tmp.md"
alias cc="claude"
alias oc="opencode"
alias ocp="opencode --port"
alias ocr="opencode run"
alias lg="lazygit"
alias ld="lazydocker"

t() {
  # Check tmux version supports -O flag (3.7+)
  local ver=$(tmux -V | sed 's/[^0-9.]//g' | cut -d. -f1,2)
  if (( $(echo "$ver < 3.7" | bc -l) )); then
    echo "your version of tmux doesn't support the \"-O\" flag; session switch keybinds have to be updated. update tmux by running 'brew install tmux --HEAD'"
    return 1
  fi
  # Attach to existing server, or create new with float + m*
  if tmux list-sessions &>/dev/null; then
    tmux attach -t float 2>/dev/null || tmux attach
  else
    tmux new -d -s float
    tmux new -A -s 'm*'
  fi
}

alias tx="tmux kill-server"
alias td="tmux detach-client"
alias c="clear"
alias k="kubecli"
alias tf="terraform"

# folders
alias main="cd ~/_main"
alias config="cd ~/.config"
alias projects="cd ~/_main/projects"
alias resources="cd ~/_main/resources"
alias general="cd ~/_main/vault-general/"

# mkdir and cd into
mkcd () {
  \mkdir -p "$1"
  cd "$1"
}

# mk temp dir
tempe () {
  cd "$(mktemp -d)"
  chmod -R 0700 .
  if [[ $# -eq 1 ]]; then
    \mkdir -p "$1"
    cd "$1"
    chmod -R 0700 .
  fi
}

# if [ "$TMUX" = "" ]; then tmux new -A -s "m*"; fi

# if [ "$TERM_PROGRAM" != "Apple_Terminal" ]; then
#   eval "$(oh-my-posh init zsh)";
# fi

eval "$(oh-my-posh init zsh --config ~/.config/ohmyposh/base.json)"

# bun completions
# [ -s "/Users/mishka/.bun/_bun" ] && source "/Users/mishka/.bun/_bun"

# bun
# export BUN_INSTALL="$HOME/.bun"
# export PATH="$BUN_INSTALL/bin:$PATH"

alias tsave="$HOME/.config/tmux_scripts/tsave"
alias tload="$HOME/.config/tmux_scripts/tload"

# Tab-complete snapshot names for tload (completes from ~/.config/tmux_sessions/*.json):
_tload() { compadd -- ${(f)"$(cd ~/.config/tmux_sessions 2>/dev/null && ls *.json(:r) 2>/dev/null)"}; }
compdef _tload tload

# List saved snapshots:
alias tls="ls ~/.config/tmux_sessions/*.md 2>/dev/null | sed 's#.*/##;s#\.md\$##'"


nvim()  { command nvim "$@"; printf '\e[4 q'; }
claude() { command claude "$@"; printf '\e[4 q'; }

export CLAUDE_CONFIG_DIR=~/.config/claude

# Hammerspoon is a GUI app and can't see this shell env, so its config dir is set via the
# MJConfigFile default (not an env var). Verify on shell start; correct if it drifted.
# Takes effect on Hammerspoon's next launch.
if [[ "$(defaults read org.hammerspoon.Hammerspoon MJConfigFile 2>/dev/null)" != "$HOME/.config/hammerspoon/init.lua" ]]; then
  defaults write org.hammerspoon.Hammerspoon MJConfigFile "$HOME/.config/hammerspoon/init.lua"
fi
