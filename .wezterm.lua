local wezterm = require("wezterm")

local config = wezterm.config_builder()
local act = wezterm.action

-- general terminal settings
config.window_close_confirmation = "AlwaysPrompt"
config.color_scheme = "rose-pine"
-- config.use_fancy_tab_bar = false

-- remove if not on nightly
config.show_close_tab_button_in_tabs = false

-- tab bar
config.window_decorations = "RESIZE"
config.tab_max_width = 24
-- config.enable_tab_bar = false
config.hide_tab_bar_if_only_one_tab = true

-- font settings
-- config.font = wezterm.font("JetBrainsMono Nerd Font")
config.font = wezterm.font("ComicShannsMono Nerd Font")
config.font_size = 15.0
-- config.cell_width = 0.95

-- cursor
config.underline_thickness = 3
config.underline_position = -4
config.cursor_thickness = 2
config.default_cursor_style = "SteadyUnderline"

-- window settings
config.window_frame = {
	font = wezterm.font({
		-- family = "RobotoMono Nerd Font",
		family = "ComicMono Nerd Font",
		weight = "Medium",
	}),
	font_size = 17.0,
	active_titlebar_bg = "#191724",
	inactive_titlebar_bg = "#14121c",
}

-- window size
config.initial_rows = 100
config.initial_cols = 125
config.window_padding = {
	left = "0.5cell",
	right = "0.5cell",
	top = "0.5cell",
	bottom = "0cell",
}

-- colors
config.colors = {
	tab_bar = {
		active_tab = {
			bg_color = "#191724",
			fg_color = "#d6d6d6",
			intensity = "Normal",
			underline = "None",
			italic = false,
			strikethrough = false,
		},

		inactive_tab = {
			bg_color = "#191724",
			fg_color = "#808080",
		},

		inactive_tab_hover = {
			bg_color = "#191724",
			fg_color = "#909090",
			italic = true,
		},

		new_tab = {
			bg_color = "#191724",
			fg_color = "#808080",
		},

		new_tab_hover = {
			bg_color = "#232136",
			fg_color = "#909090",
		},
	},
}

-- keymaps
config.keys = {
	{
		key = "w",
		mods = "CMD|SHIFT",
		action = wezterm.action.CloseCurrentTab({ confirm = true }),
		-- action = act.PromptInputLine({
		--   description = "Are you sure you want to close the window?",
		--   action = wezterm.action_callback(function(window, line)
		--     if line == "y" then
		--       window:perform_action(act.CloseCurrentTab({ confirm = true }), window)
		--     end
		--   end),
		-- }),
	},

	{
		key = "x",
		mods = "CMD|SHIFT",
		action = wezterm.action.CloseCurrentPane({ confirm = true }),
	},

	{
		key = "RightArrow",
		mods = "CMD|CTRL",
		action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }),
	},

	{
		key = "DownArrow",
		mods = "CMD|CTRL",
		action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }),
	},

	{
		key = "LeftArrow",
		mods = "CMD|SHIFT",
		action = wezterm.action.ActivatePaneDirection("Left"),
	},

	{
		key = "RightArrow",
		mods = "CMD|SHIFT",
		action = wezterm.action.ActivatePaneDirection("Right"),
	},

	{
		key = "UpArrow",
		mods = "CMD|SHIFT",
		action = wezterm.action.ActivatePaneDirection("Up"),
	},

	{
		key = "DownArrow",
		mods = "CMD|SHIFT",
		action = wezterm.action.ActivatePaneDirection("Down"),
	},
	{
		key = "LeftArrow",
		mods = "CMD|SHIFT|ALT",
		action = wezterm.action.AdjustPaneSize({ "Left", 3 }),
	},

	{
		key = "RightArrow",
		mods = "CMD|SHIFT|ALT",
		action = wezterm.action.AdjustPaneSize({ "Right", 3 }),
	},

	{
		key = "UpArrow",
		mods = "CMD|SHIFT|ALT",
		action = wezterm.action.AdjustPaneSize({ "Up", 3 }),
	},

	{
		key = "DownArrow",
		mods = "CMD|SHIFT|ALT",
		action = wezterm.action.AdjustPaneSize({ "Down", 3 }),
	},

	{
		key = "t",
		mods = "CMD|SHIFT",
		action = act.PromptInputLine({
			description = "Enter new name for tab",
			action = wezterm.action_callback(function(window, pane, line)
				-- line will be `nil` if they hit escape without entering anything
				-- An empty string if they just hit enter
				-- Or the actual line of text they wrote
				if line then
					window:active_tab():set_title(line)
				end
			end),
		}),
	},
}

return config
