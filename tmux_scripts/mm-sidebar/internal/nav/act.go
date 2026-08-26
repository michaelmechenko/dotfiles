package nav

import "mm-sidebar/internal/tmuxio"

// Act performs a row's action. ActionEditFile is handled by the caller (it has
// to suspend the TUI), so it is a no-op here.
func Act(client *tmuxio.Client, r Row, content tmuxio.PaneRef) {
	switch r.Kind {
	case ActionFocusPane:
		client.FocusPaneRef(r.Pane)
	case ActionOpenDir:
		client.SplitAt(content, r.Path)
	case ActionOpenFile:
		client.OpenFileAt(content, openTargetPath(), r.Path)
	}
}
