package nav

import "mm-sidebar/internal/tmuxio"

// Act performs a row's action. ActionEditFile is handled by the caller (it has
// to suspend the TUI), so it is a no-op here.
func Act(r Row, contentPane string) {
	switch r.Kind {
	case ActionFocusPane:
		tmuxio.FocusPane(r.PaneID, r.Target)
	case ActionOpenDir:
		tmuxio.SplitAt(contentPane, r.Path)
	case ActionOpenFile:
		_ = OpenFileCmd(contentPane, r.Path).Run()
	}
}
