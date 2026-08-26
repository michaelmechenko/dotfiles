package nav

import (
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"mm-sidebar/internal/projectcatalog"
	"mm-sidebar/internal/tmuxio"
	wtapi "mm-sidebar/internal/worktrunk"
)

// ContextAction is a row-owned command exposed through the generic action
// palette. Sources build descriptors with stable identities; model.go only
// presents and dispatches them, so adding a source never adds a source-name
// branch to the input loop.
type ContextAction struct {
	ID          string
	Label       string
	Destructive bool
	Kind        ContextActionKind
	Pane        tmuxio.PaneRef
	SessionID   string
	PaneID      string
	Target      string
	Path        string
	Agent       string
	Text        string
	RepoRoot    string
	Branch      string
	CommonDir   string
}

type ContextActionKind uint8

const (
	ContextFocusPane ContextActionKind = iota
	ContextLabelPane
	ContextRenameWindow
	ContextToggleZoom
	ContextKillPane
	ContextRenameSession
	ContextKillSession
	ContextOpenFile
	ContextOpenDir
	ContextNewWindow
	ContextCopyPath
	ContextRevealPath
	ContextOpenParent
	ContextAgentResponse
	ContextAgentPlan
	ContextCopyText
	ContextPreviewPane
	ContextMaterializeBranch
	ContextPinRepository
	ContextUnpinRepository
	ContextForgetRepository
)

func paneActions(p tmuxio.PaneRow) []ContextAction {
	ref := p.Ref()
	return []ContextAction{
		{ID: "focus", Label: "focus pane", Kind: ContextFocusPane, Pane: ref, PaneID: p.PaneID, Target: p.Target},
		{ID: "label", Label: "set pane label", Kind: ContextLabelPane, Pane: ref},
		{ID: "rename-window", Label: "rename window", Kind: ContextRenameWindow, Pane: ref},
		{ID: "zoom", Label: "toggle pane zoom", Kind: ContextToggleZoom, Pane: ref},
		{ID: "preview", Label: "preview pane", Kind: ContextPreviewPane, Pane: ref},
		{ID: "kill-pane", Label: "kill pane", Destructive: true, Kind: ContextKillPane, Pane: ref},
	}
}

func sessionActions(s tmuxio.Session, p tmuxio.PaneRow, hasPane bool) []ContextAction {
	actions := []ContextAction{}
	if hasPane {
		actions = append(actions, ContextAction{ID: "focus", Label: "focus session", Kind: ContextFocusPane, Pane: p.Ref(), PaneID: p.PaneID, Target: p.Target})
	}
	return append(actions,
		ContextAction{ID: "rename-session", Label: "rename session", Kind: ContextRenameSession, SessionID: s.ID},
		ContextAction{ID: "kill-session", Label: "kill session", Destructive: true, Kind: ContextKillSession, SessionID: s.ID},
	)
}

func fileActions(path string) []ContextAction {
	return []ContextAction{
		{ID: "open", Label: "open file", Kind: ContextOpenFile, Path: path},
		{ID: "open-parent", Label: "open parent split", Kind: ContextOpenParent, Path: path},
		{ID: "copy-path", Label: "copy path", Kind: ContextCopyPath, Path: path},
		{ID: "reveal", Label: "reveal in Finder", Kind: ContextRevealPath, Path: path},
	}
}

func dirActions(path string) []ContextAction {
	return projectDirActions(path, "")
}

// projectDirActions attaches a canonical Git identity only for project rows;
// all other directory rows keep the ordinary generic actions unchanged.
func projectDirActions(path, commonDir string) []ContextAction {
	return []ContextAction{
		{ID: "open", Label: "open split here", Kind: ContextOpenDir, Path: path, CommonDir: commonDir},
		{ID: "new-window", Label: "new window here", Kind: ContextNewWindow, Path: path, CommonDir: commonDir},
		{ID: "copy-path", Label: "copy path", Kind: ContextCopyPath, Path: path},
		{ID: "reveal", Label: "reveal in Finder", Kind: ContextRevealPath, Path: path},
	}
}

// ContextExecutor is the sole dispatcher for descriptors. Its Worktrunk client
// is injectable for tests; the zero value uses the bounded wt adapter.
type ContextExecutor struct {
	Worktrunk wtapi.Client
	Catalog   *projectcatalog.Catalog
	// ListPanes exists so action-time liveness can be tested without a tmux
	// server. Production uses the one explicit global query below.
	ListPanes func() ([]tmuxio.PaneRow, error)
}

// ActionResult is source-neutral completion data. Model code only understands
// its refresh request, so new source actions need no source-name branch.
type ActionResult struct {
	Refresh bool
}

func (e ContextExecutor) catalog() *projectcatalog.Catalog {
	if e.Catalog != nil {
		return e.Catalog
	}
	return projectcatalog.New(projectcatalog.Config{})
}

func (e ContextExecutor) listPanes(client *tmuxio.Client) ([]tmuxio.PaneRow, error) {
	if e.ListPanes != nil {
		return e.ListPanes()
	}
	return client.ListPanes()
}

func (e ContextExecutor) projectMatches(path, commonDir string) bool {
	if commonDir == "" {
		return true
	}
	identity, err := e.catalog().Resolve(path)
	return err == nil && identity.CommonDir == commonDir
}

// ExecuteContextAction uses the default executor for production callers.
func ExecuteContextAction(client *tmuxio.Client, action ContextAction, content tmuxio.PaneRef) (ActionResult, error) {
	return (ContextExecutor{}).Execute(client, action, content)
}

// Execute dispatches one row-owned action. Targeted tmux operations call
// tmuxio's guarded methods; model.go never recognizes the source that produced
// the descriptor.
func (e ContextExecutor) Execute(client *tmuxio.Client, action ContextAction, content tmuxio.PaneRef) (ActionResult, error) {
	result := ActionResult{}
	switch action.Kind {
	case ContextFocusPane:
		if action.Pane.SessionID != "" {
			client.FocusPaneRef(action.Pane)
		} else {
			client.FocusPane(action.PaneID, action.Target)
		}
	case ContextLabelPane:
		client.PromptPaneLabel(action.Pane)
	case ContextRenameWindow:
		client.PromptRenameWindow(action.Pane)
	case ContextToggleZoom:
		client.TogglePaneZoom(action.Pane)
	case ContextKillPane:
		client.KillPane(action.Pane)
	case ContextRenameSession:
		client.PromptRenameSession(action.SessionID)
	case ContextKillSession:
		client.KillSession(action.SessionID)
	case ContextOpenFile:
		client.OpenFileAt(content, openTargetPath(), action.Path)
	case ContextOpenDir:
		if !e.projectMatches(action.Path, action.CommonDir) {
			return result, fmt.Errorf("repository changed; worktree not opened")
		}
		client.SplitAt(content, action.Path)
	case ContextNewWindow:
		if !e.projectMatches(action.Path, action.CommonDir) {
			return result, fmt.Errorf("repository changed; worktree not opened")
		}
		client.NewWindowAt(action.Path)
	case ContextCopyPath:
		copyPath(action.Path)
	case ContextRevealPath:
		_ = exec.Command("open", "-R", action.Path).Run()
	case ContextOpenParent:
		client.SplitAt(content, filepath.Dir(action.Path))
	case ContextAgentResponse:
		name := "tmux-pi-last-response"
		if action.Agent == "claude" {
			name = "tmux-claude-last-response"
		}
		client.RunScriptAtPane(action.Pane, scriptPath(name))
	case ContextAgentPlan:
		client.RunScriptAtPane(action.Pane, scriptPath("tmux-M-P-dispatch"))
	case ContextCopyText:
		copyText(action.Text)
	case ContextMaterializeBranch:
		identity, err := e.catalog().Resolve(action.RepoRoot)
		if err != nil || identity.CommonDir != action.CommonDir {
			return result, fmt.Errorf("repository changed; worktree not created")
		}
		if !client.PaneMatches(content) {
			return result, fmt.Errorf("content pane moved; worktree not created")
		}
		worktree, err := e.Worktrunk.Switch(action.RepoRoot, action.Branch)
		if err != nil {
			return result, err
		}
		identity, err = e.catalog().Resolve(worktree.Path)
		if err != nil || identity.CommonDir != action.CommonDir {
			return result, fmt.Errorf("repository changed; worktree not opened")
		}
		client.SplitAt(content, worktree.Path)
		result.Refresh = true
	case ContextPinRepository:
		if err := e.catalog().SetPinned(action.CommonDir, true); err != nil {
			return result, err
		}
		result.Refresh = true
	case ContextUnpinRepository:
		if err := e.catalog().SetPinned(action.CommonDir, false); err != nil {
			return result, err
		}
		result.Refresh = true
	case ContextForgetRepository:
		panes, err := e.listPanes(client)
		if err != nil {
			return result, err
		}
		for _, pane := range panes {
			if pane.Sidebar || pane.CurrentPath == "" {
				continue
			}
			identity, err := e.catalog().Resolve(pane.CurrentPath)
			if err == nil && identity.CommonDir == action.CommonDir {
				return result, errors.New("project is live; cannot forget")
			}
		}
		if err := e.catalog().Forget(action.CommonDir); err != nil {
			return result, err
		}
		result.Refresh = true
	}
	return result, nil
}

func copyPath(path string) { copyText(path) }

func copyText(text string) {
	cmd := exec.Command("pbcopy")
	cmd.Stdin = strings.NewReader(text)
	// pbcopy is intentionally best-effort: a headless test or SSH environment
	// must not make an otherwise-valid palette action fatal.
	_ = cmd.Run()
}
