local wezterm = require("wezterm")
local act = wezterm.action
local config = wezterm.config_builder()

-- Colors: vague theme, with the same background/foreground/ANSI-12/ANSI-14
-- overrides applied in ghostty/config (see COLORS.md for the palette source
-- of truth).
config.colors = {
	foreground = "#cdcdcd",
	background = "#100E11", -- matches tmux window-style bg (ghostty/config)
	cursor_bg = "#cdcdcd",
	cursor_border = "#cdcdcd",
	cursor_fg = "#100E11",
	selection_bg = "#252530",
	selection_fg = "#cdcdcd",
	split = "#878787",
	ansi = {
		"#252530", -- 0
		"#d8647e", -- 1
		"#bb9dbd", -- 2
		"#bebedb", -- 3
		"#f3be7c", -- 4
		"#90a0b5", -- 5
		"#aeaed1", -- 6
		"#cdcdcd", -- 7
	},
	brights = {
		"#606079", -- 8
		"#e08398", -- 9
		"#99b782", -- 10
		"#f5cb96", -- 11
		"#aeaed1", -- 12 (remapped from #8ba9c1 -> accent-secondary lavender)
		"#c9b1ca", -- 13
		"#606079", -- 14 (remapped from #bebeda -> dims Claude Code session-rename label)
		"#d7d7d7", -- 15
	},
}

-- Cursor
config.default_cursor_style = "SteadyUnderline" -- cursor-style=underline, cursor-style-blink=false

-- Window
config.window_padding = {
	left = 12,
	right = 12,
	top = 10,
	bottom = 2,
}
-- RESIZE alone: no titlebar, but keep resizable-border behavior (WezTerm's
-- docs warn dropping RESIZE breaks resize/minimize). MACOS_FORCE_DISABLE_SHADOW
-- matches ghostty's macos-window-shadow = false.
config.window_decorations = "RESIZE|MACOS_FORCE_DISABLE_SHADOW"
config.window_close_confirmation = "NeverPrompt"
config.window_background_opacity = 1.0

-- No tabs at all (ghostty has no tab bar concept either)
config.enable_tab_bar = false

-- Font
config.font = wezterm.font("Lilex", { weight = 425 })
config.font_size = 14.0
config.line_height = 1.04 -- approximates ghostty's adjust-cell-height = 4%
config.harfbuzz_features = {
	"cv01", -- alt 'a'
	"cv02", -- alt 'g'
	"cv09", -- lifted *
	"zero", -- slashed/dotted zero
}

-- Shell integration equivalent (wezterm has its own OSC 133 support built in;
-- no config needed, unlike ghostty's shell-integration setting)

-- Keybindings (mirroring ghostty/config)
config.keys = {
	{ key = "x", mods = "CMD|SHIFT", action = act.CloseCurrentPane({ confirm = false } ) },
	{ key = "q", mods = "CMD", action = act.QuitApplication },
	{ key = "r", mods = "CMD|SHIFT", action = act.ReloadConfiguration },

	-- alt+left / alt+right as CSI 1;3D / 1;3C
	{ key = "LeftArrow", mods = "ALT", action = act.SendString("\x1b[1;3D") },
	{ key = "RightArrow", mods = "ALT", action = act.SendString("\x1b[1;3C") },

	-- alt+enter / shift+enter / ctrl+enter as CSI-u so pi/tmux can distinguish them
	{ key = "Enter", mods = "ALT", action = act.SendString("\x1b[13;3u") },
	{ key = "Enter", mods = "SHIFT", action = act.SendString("\x1b[13;2u") },
	{ key = "Enter", mods = "CTRL", action = act.SendString("\x1b[13;5u") },

	-- ctrl+tab -> F13 (unmodified so tmux forwards it verbatim; zsh binds it
	-- to accept-autosuggestion)
	{ key = "Tab", mods = "CTRL", action = act.SendString("\x1b[25~") },
}

return config
