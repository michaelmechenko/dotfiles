local wezterm = require("wezterm")

local config = wezterm.config_builder()
local act = wezterm.action

-- general terminal settings
config.window_close_confirmation = "AlwaysPrompt"
config.default_cursor_style = "SteadyUnderline"
config.color_scheme = "rose-pine"
-- config.use_fancy_tab_bar = false

-- remove window bar, keep tab bar
config.window_decorations = "RESIZE"

-- font settings
-- config.font = wezterm.font("JetBrainsMono Nerd Font")
config.font = wezterm.font("ComicShannsMono Nerd Font")
config.font_size = 15.0
config.initial_rows = 100
config.initial_cols = 125
config.underline_thickness = 3
config.underline_position = -4
config.cursor_thickness = 2

-- window settings
config.window_frame = {
	font = wezterm.font({ family = "RobotoMono Nerd Font", weight = "DemiBold" }),

	-- The size of the font in the tab bar.
	font_size = 14.0,

	-- The overall background color of the tab bar when
	-- the window is focused
	active_titlebar_bg = "#191724",

	-- The overall background color of the tab bar when
	-- the window is not focused
	inactive_titlebar_bg = "#14121c",
}

config.window_padding = {
	left = "0.5cell",
	right = "0.5cell",
	top = "0.2cell",
	bottom = "0",
}

-- colors
config.colors = {
	tab_bar = {
		active_tab = {
			-- The color of the background area for the tab
			bg_color = "#191724",
			-- The color of the text for the tab
			fg_color = "#d6d6d6",

			-- Specify whether you want "Half", "Normal" or "Bold" intensity for the
			-- label shown for this tab.
			-- The default is "Normal"
			intensity = "Normal",

			-- Specify whether you want "None", "Single" or "Double" underline for
			-- label shown for this tab.
			-- The default is "None"
			underline = "None",

			-- Specify whether you want the text to be italic (true) or not (false)
			-- for this tab.  The default is false.
			italic = false,

			-- Specify whether you want the text to be rendered with strikethrough (true)
			-- or not for this tab.  The default is false.
			strikethrough = false,
		},

		inactive_tab = {
			bg_color = "#191724",
			fg_color = "#808080",

			-- The same options that were listed under the `active_tab` section above
			-- can also be used for `inactive_tab`.
		},
		-- You can configure some alternate styling when the mouse pointer
		-- moves over inactive tabs
		inactive_tab_hover = {
			bg_color = "#191724",
			fg_color = "#909090",
			italic = true,

			-- The same options that were listed under the `active_tab` section above
			-- can also be used for `inactive_tab_hover`.
		},

		-- The new tab button that let you create new tabs
		new_tab = {
			bg_color = "#191724",
			fg_color = "#808080",

			-- The same options that were listed under the `active_tab` section above
			-- can also be used for `new_tab`.
		},

		-- You can configure some alternate styling when the mouse pointer
		-- moves over the new tab button
		new_tab_hover = {
			bg_color = "#232136",
			fg_color = "#909090",
			italic = true,

			-- The same options that were listed under the `active_tab` section above
			-- can also be used for `new_tab_hover`.
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
