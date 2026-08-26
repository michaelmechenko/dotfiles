package nav

import (
	"fmt"

	"mm-sidebar/internal/projectcatalog"
	"mm-sidebar/internal/tmuxio"
)

// Act performs a row's action. ActionEditFile is handled by the caller (it has
// to suspend the TUI), so it is a no-op here.
func Act(client *tmuxio.Client, r Row, content tmuxio.PaneRef) error {
	switch r.Kind {
	case ActionFocusPane:
		client.FocusPaneRef(r.Pane)
	case ActionOpenDir:
		if r.CommonDir != "" {
			identity, err := projectcatalog.ResolveGit(r.Path)
			if err != nil || identity.CommonDir != r.CommonDir {
				return fmt.Errorf("repository changed; worktree not opened")
			}
		}
		client.SplitAt(content, r.Path)
	case ActionOpenFile:
		client.OpenFileAt(content, openTargetPath(), r.Path)
	}
	return nil
}
