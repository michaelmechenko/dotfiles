local wezterm = require("wezterm")
local config = wezterm.config_builder()
local act = wezterm.action
local mux = wezterm.mux

-- local resurrect = wezterm.plugin.require("https://github.com/MLFlexer/resurrect.wezterm")

local function num_tabs(window)
	local tab_arr = window:mux_window():tabs()
	return #tab_arr
end

local function tabs_greater_than_1(window)
	return num_tabs(window) > 1
end

wezterm.on("gui-startup", function(cmd)
	local tab = mux.spawn_window(cmd or {})
	local new_title = "1"
	tab:set_title(new_title)
end)

local default_top_padding = "0.4cell"
local default_bottom_padding = "0.0cell"
local default_left_padding = "0.6cell"
local default_right_padding = "0.6cell"

local tabs_top_padding = "0.0cell"
local tabs_bottom_padding = "0.0cell"
local tabs_left_padding = "0.4cell"
local tabs_right_padding = "0.4cell"

-- general terminal settings
config.window_close_confirmation = "AlwaysPrompt"
-- config.color_scheme = "rose-pine"
config.color_scheme = "Kanagawa (Gogh)"
config.show_tab_index_in_tab_bar = false
config.show_new_tab_button_in_tab_bar = false
-- config.tab_bar_at_bottom = true
-- config.use_fancy_tab_bar = false

-- remove if not on nightly
config.show_close_tab_button_in_tabs = false

-- tab bar
config.window_decorations = "RESIZE"
-- config.enable_tab_bar = false
-- config.hide_tab_bar_if_only_one_tab = true

-- font settings
-- config.font = wezterm.font("JetBrainsMono Nerd Font")
config.font = wezterm.font("ComicShannsMono Nerd Font")
config.font_size = 17.8
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
	active_titlebar_bg = "#1F1F28",
	inactive_titlebar_bg = "#1F1F28",
}

-- window size
config.initial_rows = 100
config.initial_cols = 100

-- colors
config.colors = {
	tab_bar = {
		active_tab = {
			bg_color = "#1F1F28",
			fg_color = "#d6d6d6",
			intensity = "Normal",
			underline = "None",
			italic = false,
			strikethrough = false,
		},

		inactive_tab_edge = "#191724",

		inactive_tab = {
			bg_color = "#1F1F28",
			fg_color = "#808080",
		},

		inactive_tab_hover = {
			bg_color = "#1F1F28",
			fg_color = "#909090",
			italic = true,
		},

		new_tab = {
			bg_color = "#1F1F28",
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
		action = act.Multiple({
			-- wezterm.action_callback(function(win, pane)
			-- resurrect.save_state(resurrect.workspace_state.get_workspace_state())
			-- end),
			act.CloseCurrentTab({ confirm = true }),
		}),
	},

	{
		key = "s",
		mods = "CMD|SHIFT",
		action = wezterm.action_callback(function()
			-- resurrect.save_state(resurrect.workspace_state.get_workspace_state())
			-- resurrect.window_state.save_window_action()
		end),
	},

	{
		key = "x",
		mods = "CMD|SHIFT",
		action = act.CloseCurrentPane({ confirm = true }),
	},

	{
		key = "RightArrow",
		mods = "CMD|CTRL",
		action = act.SplitHorizontal({ domain = "CurrentPaneDomain" }),
	},

	{
		key = "DownArrow",
		mods = "CMD|CTRL",
		action = act.SplitVertical({ domain = "CurrentPaneDomain" }),
	},

	{
		key = "LeftArrow",
		mods = "CMD|SHIFT",
		action = act.ActivatePaneDirection("Left"),
	},

	{
		key = "RightArrow",
		mods = "CMD|SHIFT",
		action = act.ActivatePaneDirection("Right"),
	},

	{
		key = "UpArrow",
		mods = "CMD|SHIFT",
		action = act.ActivatePaneDirection("Up"),
	},

	{
		key = "DownArrow",
		mods = "CMD|SHIFT",
		action = act.ActivatePaneDirection("Down"),
	},

	{
		key = "LeftArrow",
		mods = "CMD|SHIFT|ALT",
		action = act.AdjustPaneSize({ "Left", 3 }),
	},

	{
		key = "RightArrow",
		mods = "CMD|SHIFT|ALT",
		action = act.AdjustPaneSize({ "Right", 3 }),
	},

	{
		key = "UpArrow",
		mods = "CMD|SHIFT|ALT",
		action = act.AdjustPaneSize({ "Up", 3 }),
	},

	{
		key = "DownArrow",
		mods = "CMD|SHIFT|ALT",
		action = act.AdjustPaneSize({ "Down", 3 }),
	},

	{
		key = "t",
		mods = "CMD",
		action = act.Multiple({
			act.SpawnTab("CurrentPaneDomain"),
			wezterm.action_callback(function(window)
				local tab_num = num_tabs(window)
				local new_title = tab_num
				window:active_tab():set_title(new_title)
			end),
		}),
	},

	{
		key = "t",
		mods = "CMD|SHIFT",
		action = act.PromptInputLine({
			description = "Enter new name for tab",
			action = wezterm.action_callback(function(window, line)
				window:active_tab():set_title(line)
			end),
		}),
	},

	-- {
	-- 	key = "O",
	-- 	mods = "CMD|SHIFT",
	-- 	action = wezterm.action_callback(function(win, pane)
	-- 		resurrect.fuzzy_load(win, pane, function(id)
	-- 			local type = string.match(id, "^([^/]+)") -- match before '/'
	-- 			id = string.match(id, "([^/]+)$") -- match after '/'
	-- 			id = string.match(id, "(.+)%..+$") -- remove file extension
	-- 			local state
	-- 			if type == "workspace" then
	-- 				state = resurrect.load_state(id, "workspace")
	-- 				resurrect.workspace_state.restore_workspace(state, {
	-- 					relative = true,
	-- 					restore_text = true,
	-- 					on_pane_restore = resurrect.tab_state.default_on_pane_restore,
	-- 				})
	-- 			elseif type == "window" then
	-- 				state = resurrect.load_state(id, "window")
	-- 				resurrect.window_state.restore_window(pane:window(), state, {
	-- 					relative = true,
	-- 					restore_text = true,
	-- 					on_pane_restore = resurrect.tab_state.default_on_pane_restore,
	-- 					-- uncomment this line to use active tab when restoring
	-- 					-- tab = win:active_tab(),
	-- 				})
	-- 			end
	-- 		end)
	-- 	end),
	-- },
}

wezterm.on("update-right-status", function(window)
	local overrides = window:get_config_overrides() or {}
	local tabs_gt_1 = tabs_greater_than_1(window)

  -- uncomment to hide unless tabs > 1
	-- overrides.enable_tab_bar = tabs_gt_1
	overrides.enable_tab_bar = true
	if tabs_gt_1 then
		overrides.window_padding = {
			top = tabs_top_padding,
			bottom = tabs_bottom_padding,
			left = tabs_left_padding,
			right = tabs_right_padding,
		}
	else
		overrides.window_padding = {
			-- top = default_top_padding,
			-- bottom = default_bottom_padding,
			-- left = default_left_padding,
			-- right = default_right_padding,
			top = tabs_top_padding,
			bottom = tabs_bottom_padding,
			left = tabs_left_padding,
			right = tabs_right_padding,
		}
	end

	window:set_config_overrides(overrides)
end)

return config
