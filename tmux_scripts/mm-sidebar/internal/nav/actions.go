package nav

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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
	ID             string
	Label          string
	Destructive    bool
	Kind           ContextActionKind
	Pane           tmuxio.PaneRef
	SessionID      string
	PaneID         string
	Target         string
	Path           string
	Agent          string
	AgentSessionID string // expected live Claude/pi session, not tmux session
	Text           string
	RepoRoot       string
	Branch         string
	CommonDir      string

	// Local is applied by the sidebar after asynchronous repository validation.
	// SourceID and SourceControl are meaningful only for LocalEffectSource.
	Local         LocalEffect
	SourceID      string
	SourceControl SourceControl
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
	ContextPreviewPath
	ContextMaterializeBranch
	ContextPinRepository
	ContextUnpinRepository
	ContextForgetRepository
	ContextOpenLazygit
	ContextOpenPi
	ContextOpenClaude
)

// LocalEffect is an in-sidebar transition which deliberately does not shell out
// through tmux. Context actions describe it declaratively, allowing model.go to
// apply source and editor lifecycle changes without recognizing their source.
type LocalEffect uint8

const (
	LocalEffectNone LocalEffect = iota
	LocalEffectSource
	LocalEffectEditFile
	LocalEffectInspectAgent
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
		{ID: "preview", Label: "preview file", Kind: ContextPreviewPath, Path: path},
		{ID: "open", Label: "open file", Kind: ContextOpenFile, Path: path},
		{ID: "open-parent", Label: "open parent split", Kind: ContextOpenParent, Path: path},
		{ID: "copy-path", Label: "copy path", Kind: ContextCopyPath, Path: path},
		{ID: "reveal", Label: "reveal in file manager", Kind: ContextRevealPath, Path: path},
	}
}

func dirActions(path string) []ContextAction {
	return append([]ContextAction{{ID: "preview", Label: "preview directory", Kind: ContextPreviewPath, Path: path}}, projectDirActions(path, "")...)
}

// projectDirActions attaches a canonical Git identity only for project rows;
// all other directory rows keep the ordinary generic actions unchanged.
func projectDirActions(path, commonDir string) []ContextAction {
	return []ContextAction{
		{ID: "open", Label: "open split here", Kind: ContextOpenDir, Path: path, CommonDir: commonDir},
		{ID: "new-window", Label: "new window here", Kind: ContextNewWindow, Path: path, CommonDir: commonDir},
		{ID: "copy-path", Label: "copy path", Kind: ContextCopyPath, Path: path},
		{ID: "reveal", Label: "reveal in file manager", Kind: ContextRevealPath, Path: path},
	}
}

// projectActions is the ordered action center for a materialized worktree. A
// focus action is prepended only when this exact worktree already owns a live
// pane. Enter remains the row's primary action; this list is only for a/:.
func projectActions(path, commonDir string, pane *tmuxio.PaneRow) []ContextAction {
	path, commonDir = cleanProjectPath(path), cleanProjectPath(commonDir)
	actions := make([]ContextAction, 0, 10)
	if pane != nil {
		ref := pane.Ref()
		actions = append(actions, ContextAction{ID: "focus", Label: "focus worktree pane", Kind: ContextFocusPane, Pane: ref, PaneID: pane.PaneID, Target: pane.Target})
	}
	actions = append(actions,
		ContextAction{ID: "shell-split", Label: "open shell split", Kind: ContextOpenDir, Path: path, CommonDir: commonDir},
		ContextAction{ID: "shell-window", Label: "open shell window", Kind: ContextNewWindow, Path: path, CommonDir: commonDir},
		ContextAction{ID: "filetree", Label: "browse filetree", RepoRoot: path, CommonDir: commonDir, Local: LocalEffectSource, SourceID: Filetree{}.ID(), SourceControl: SourceControl{Root: path, SetRoot: true, RootPinned: true, SetRootPinned: true, Refresh: true}},
		ContextAction{ID: "lazygit", Label: "open lazygit", Kind: ContextOpenLazygit, Path: path, CommonDir: commonDir},
		ContextAction{ID: "scratch", Label: "edit project scratch", RepoRoot: path, CommonDir: commonDir, Local: LocalEffectEditFile, Path: filepath.Join(ScratchDir(), Slug(path)+".md")},
		ContextAction{ID: "pi", Label: "open pi", Kind: ContextOpenPi, Path: path, CommonDir: commonDir},
		ContextAction{ID: "claude", Label: "open Claude", Kind: ContextOpenClaude, Path: path, CommonDir: commonDir},
		ContextAction{ID: "copy-path", Label: "copy path", Kind: ContextCopyPath, Path: path},
		ContextAction{ID: "reveal", Label: "reveal in file manager", Kind: ContextRevealPath, Path: path},
	)
	return actions
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

// ValidateProjectAction checks the canonical repository identity retained by a
// local TUI action before model.go mutates source/editor state.
func ValidateProjectAction(action ContextAction) error {
	if action.CommonDir == "" {
		return nil
	}
	root := action.RepoRoot
	if root == "" {
		root = action.Path
	}
	if !(ContextExecutor{}).projectMatches(root, action.CommonDir) {
		return fmt.Errorf("repository changed; action cancelled")
	}
	return nil
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
		if info, err := os.Stat(action.Path); err != nil || !info.IsDir() {
			return result, errors.New("path no longer exists")
		}
		if action.Pane.SessionID != "" {
			client.SplitAt(action.Pane, action.Path)
		} else {
			client.SplitAt(content, action.Path)
		}
	case ContextNewWindow:
		if !e.projectMatches(action.Path, action.CommonDir) {
			return result, fmt.Errorf("repository changed; worktree not opened")
		}
		if info, err := os.Stat(action.Path); err != nil || !info.IsDir() {
			return result, errors.New("path no longer exists")
		}
		if action.Pane.SessionID != "" {
			client.NewWindowAt(action.Pane, action.Path)
		} else {
			client.NewWindowAt(content, action.Path)
		}
	case ContextCopyPath:
		copyPath(action.Path)
	case ContextRevealPath:
		if _, err := os.Stat(action.Path); err != nil {
			return result, errors.New("path no longer exists")
		}
		if runtime.GOOS == "darwin" {
			_ = exec.Command("open", "-R", action.Path).Run()
		} else if _, err := exec.LookPath("dolphin"); err == nil {
			_ = exec.Command("dolphin", "--select", action.Path).Run()
		} else {
			_ = exec.Command("xdg-open", filepath.Dir(action.Path)).Run()
		}
	case ContextOpenParent:
		client.SplitAt(content, filepath.Dir(action.Path))
	case ContextAgentResponse:
		name := "tmux-pi-last-response"
		if action.Agent == "claude" {
			name = "tmux-claude-last-response"
		}
		client.RunAgentScriptAtPane(action.Pane, scriptPath(name), action.Agent, action.AgentSessionID)
	case ContextAgentPlan:
		client.RunAgentScriptAtPane(action.Pane, scriptPath("tmux-M-P-dispatch"), action.Agent, action.AgentSessionID)
	case ContextCopyText:
		copyText(action.Text)
	case ContextOpenLazygit:
		if !e.projectMatches(action.Path, action.CommonDir) {
			return result, fmt.Errorf("repository changed; lazygit not opened")
		}
		client.OpenLazygitAt(content, action.Path)
	case ContextOpenPi:
		if !e.projectMatches(action.Path, action.CommonDir) {
			return result, fmt.Errorf("repository changed; pi not opened")
		}
		client.OpenAgentAt(content, action.Path, "pi")
	case ContextOpenClaude:
		if !e.projectMatches(action.Path, action.CommonDir) {
			return result, fmt.Errorf("repository changed; Claude not opened")
		}
		client.OpenAgentAt(content, action.Path, "claude")
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
	name := "pbcopy"
	if runtime.GOOS != "darwin" {
		name = "wl-copy"
	}
	cmd := exec.Command(name)
	cmd.Stdin = strings.NewReader(text)
	// Clipboard writes are best-effort: a headless test or SSH environment must
	// not make an otherwise-valid palette action fatal.
	_ = cmd.Run()
}
