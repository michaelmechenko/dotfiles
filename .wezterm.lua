local wezterm = require("wezterm")

local config = wezterm.config_builder()
local act = wezterm.action

function num_tabs(window, pane)
	local tab_arr = window:mux_window():tabs()

	return #tab_arr
end

function tabs_greater_than_1(window, pane)
	return num_tabs(window, pane) > 1
end

local default_top_padding = "0.3cell"
local default_bottom_padding = "0.0cell"
local default_left_padding = "0.6cell"
local default_right_padding = "0.6cell"

local tabs_top_padding = "0.1cell"
local tabs_bottom_padding = "0.0cell"
local tabs_left_padding = "0.6cell"
local tabs_right_padding = "0.6cell"

-- general terminal settings
config.window_close_confirmation = "AlwaysPrompt"
config.color_scheme = "rose-pine"
-- config.use_fancy_tab_bar = false

-- remove if not on nightly
config.show_close_tab_button_in_tabs = false

-- tab bar
config.window_decorations = "RESIZE"
config.tab_max_width = 24
config.enable_tab_bar = false
-- config.hide_tab_bar_if_only_one_tab = true

-- font settings
-- config.font = wezterm.font("JetBrainsMono Nerd Font")
config.font = wezterm.font("ComicShannsMono Nerd Font")
config.font_size = 18.0
config.cell_width = 0.95

-- cursor
config.underline_thickness = 3
config.underline_position = -3
config.cursor_thickness = 2
config.default_cursor_style = "SteadyUnderline"

-- window settings
config.window_frame = {
	font = wezterm.font({
		-- family = "Inconsolata Nerd Font",
		family = "mononoki",
		weight = "Medium",
	}),
	font_size = 18.0,
	active_titlebar_bg = "#191724",
	inactive_titlebar_bg = "#191724",
}

-- window size
config.initial_rows = 100
config.initial_cols = 100

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

		inactive_tab_edge = "#191724",

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

wezterm.on("update-right-status", function(window, pane)
	local overrides = window:get_config_overrides() or {}
	local tabs_gt_1 = tabs_greater_than_1(window, pane)

	overrides.enable_tab_bar = tabs_gt_1
	if tabs_gt_1 then
		overrides.window_padding = {
			top = tabs_top_padding,
			bottom = tabs_bottom_padding,
			left = tabs_left_padding,
			right = tabs_bottom_padding,
		}
	else
		overrides.window_padding = {
			top = default_top_padding,
			bottom = default_bottom_padding,
			left = default_left_padding,
			right = default_bottom_padding,
		}
	end

	window:set_config_overrides(overrides)
end)

return config
