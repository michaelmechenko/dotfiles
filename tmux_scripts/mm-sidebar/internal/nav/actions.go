package nav

import (
	"os/exec"
	"path/filepath"
	"strings"

	"mm-sidebar/internal/tmuxio"
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
	return []ContextAction{
		{ID: "open", Label: "open split here", Kind: ContextOpenDir, Path: path},
		{ID: "new-window", Label: "new window here", Kind: ContextNewWindow, Path: path},
		{ID: "copy-path", Label: "copy path", Kind: ContextCopyPath, Path: path},
		{ID: "reveal", Label: "reveal in Finder", Kind: ContextRevealPath, Path: path},
	}
}

// ExecuteContextAction is the sole dispatcher for descriptors. Targeted tmux
// operations call tmuxio's guarded methods; model.go never needs to know which
// source produced a row or whether an action targets a pane, session, file, or
// directory.
func ExecuteContextAction(client *tmuxio.Client, action ContextAction, content tmuxio.PaneRef) {
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
		client.SplitAt(content, action.Path)
	case ContextNewWindow:
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
	}
}

func copyPath(path string) { copyText(path) }

func copyText(text string) {
	cmd := exec.Command("pbcopy")
	cmd.Stdin = strings.NewReader(text)
	// pbcopy is intentionally best-effort: a headless test or SSH environment
	// must not make an otherwise-valid palette action fatal.
	_ = cmd.Run()
}
