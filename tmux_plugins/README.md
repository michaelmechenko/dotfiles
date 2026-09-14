# tmux plugin inventory

No plugin manager is loaded. These trees are either invoked directly or retained as reference.

- `extrakto/` — active through `tmux_scripts/tmux-extrakto-launch`. It is vendored and locally patched; see `AGENTS.md` before updating it.
- `tmux-fzf-url/` — inactive extraction-pattern reference for `tmux_scripts/tmux-open-picker`. Its plugin entry point is not sourced.

Unbound compatibility scripts under `tmux_scripts/` are retained deliberately while their behavior is documented in `AGENTS.md`; an unbound file is not proof that it is safe to delete.
