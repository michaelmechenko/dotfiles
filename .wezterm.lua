-- Pull in the wezterm API
local wezterm = require("wezterm")

-- This will hold the configuration.
local config = wezterm.config_builder()

-- This is where you actually apply your config choices
config.default_cursor_style = "SteadyUnderline"

-- For example, changing the color scheme:
config.color_scheme = "rose-pine"
-- config.use_fancy_tab_bar = false
config.window_decorations = "RESIZE"
-- config.font = wezterm.font 'mononoki'
config.font = wezterm.font("JetBrainsMono Nerd Font")
config.font_size = 13.0
config.initial_rows = 40
config.initial_cols = 100

config.window_frame = {
	-- The font used in the tab bar.
	-- Roboto Bold is the default; this font is bundled
	-- with wezterm.
	-- Whatever font is selected here, it will have the
	-- main font setting appended to it to pick up any
	-- fallback fonts you may have used there.
	font = wezterm.font({ family = "Futura", weight = "Light" }),

	-- The size of the font in the tab bar.
	-- Default to 10.0 on Windows but 12.0 on other systems
	font_size = 14.0,

	-- The overall background color of the tab bar when
	-- the window is focused
	active_titlebar_bg = "#191724",

	-- The overall background color of the tab bar when
	-- the window is not focused
	inactive_titlebar_bg = "#14121c",
}

config.window_padding = {
	left = "1cell",
	right = "1cell",
	top = "0.3cell",
	bottom = "0cell",
}

config.colors = {
	tab_bar = {
		active_tab = {
			-- The color of the background area for the tab
			bg_color = "#191724",
			-- The color of the text for the tab
			fg_color = "#f0f0f0",

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

config.keys = {
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
}

return config
