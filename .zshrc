# If you come from bash you might have to change your $PATH.
export PATH=$HOME/bin:/usr/local/bin:$PATH

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# CASE_SENSITIVE="true"
# HYPHEN_INSENSITIVE="true"

# zstyle ':omz:update' mode disabled
zstyle ':omz:update' mode auto
# zstyle ':omz:update' mode reminder

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

plugins=(git macos zsh-syntax-highlighting)

source $ZSH/oh-my-zsh.sh

# Preferred editor for local and remote sessions
if [[ -n $SSH_CONNECTION ]]; then
  export EDITOR='vim'
else
  export EDITOR='neovim'
fi

# Compilation flags
# export ARCHFLAGS="-arch x86_64"

eval "$(fzf --zsh)"

alias ls="eza -1"
alias lsl="eza"
# alias cat="bat"
alias e="nvim"
alias ai="aichat"
alias oc="opencode"
alias lg="lazygit"
alias ld="lazydocker"
alias t="tmux new -A -s 'm*'"
alias ts="tmux kill-session"
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

# servers
alias mcp="cd ~/mcp"

# fpath=(/Users/mishka/.docker/completions $fpath)
# autoload -Uz compinit
# compinit

if [ "$TMUX" = "" ]; then tmux new -A -s "m*"; fi

# export NVM_DIR="$HOME/.nvm"
# [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
# [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

if [ "$TERM_PROGRAM" != "Apple_Terminal" ]; then
  eval "$(oh-my-posh init zsh)"
fi

eval "$(oh-my-posh init zsh --config ~/.config/ohmyposh/base.json)"
source $(brew --prefix)/share/zsh-autosuggestions/zsh-autosuggestions.zsh
