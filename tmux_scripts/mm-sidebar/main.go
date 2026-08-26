// mm-sidebar -- the neo-tree-like left tmux sidebar.
//
// Two entry points:
//
//	mm-sidebar              run the sidebar TUI (inside the sidebar pane)
//	mm-sidebar agents       print the agent rows as TSV and exit
//
// The `agents` subcommand is the single implementation of the Claude+pi pane
// join; tmux_scripts/tmux-agent-ls is a thin wrapper over it, so shell callers
// and the sidebar itself can't drift apart. See internal/agents for the recipe
// and its cost model.
package main

import (
	"bufio"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"

	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/tmuxio"
)

const (
	originClientEnv = "MM_SIDEBAR_ORIGIN_CLIENT"
	ownerWindowEnv  = "MM_SIDEBAR_OWNER_WINDOW"
	gatePathEnv     = "MM_SIDEBAR_GATE_PATH"
)

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "agents":
			os.Exit(runAgents())
		case "-h", "--help", "help":
			usage()
			return
		default:
			fmt.Fprintf(os.Stderr, "mm-sidebar: unknown command %q\n", os.Args[1])
			usage()
			os.Exit(2)
		}
	}
	os.Exit(runSidebar())
}

func usage() {
	fmt.Fprint(os.Stderr, `usage: mm-sidebar [command]

  (no command)  run the sidebar TUI in the current pane
  agents        print one TSV row per live agent pane (11 fields) and exit
`)
}

// runAgents prints the append-only 11-field TSV schema:
// sessionId, pane_id, target, session_name, state, name, transcript, window_name,
// agent, cwd, pane_label. --tsv is accepted and ignored: it is the only output
// format, and spelling it out keeps the tmux-agent-ls wrapper self-documenting.
// Fields 10-11 were appended; consumers must retain the original 1-9 prefix.
func runAgents() int {
	rows, err := agents.NewResolver().Resolve()
	if err != nil {
		fmt.Fprintf(os.Stderr, "mm-sidebar agents: %v\n", err)
		return 1
	}
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for _, r := range rows {
		fmt.Fprintln(w, r.TSV())
	}
	return 0
}

func runSidebar() int {
	// Install HUP handling before ownership/theme initialization. The gate shell
	// ignores HUP until exec, so any signal after exec is either queued here or
	// handled by the running Bubble Tea program below.
	hup := make(chan os.Signal, 1)
	signal.Notify(hup, syscall.SIGHUP)
	defer signal.Stop(hup)

	client := tmuxio.NewClient(os.Getenv("TMUX_PANE"), os.Getenv(originClientEnv))
	if gate := os.Getenv(gatePathEnv); gate != "" {
		hupPath := gate + ".hup"
		if _, err := os.Stat(hupPath); err == nil {
			_ = os.Remove(hupPath)
			client.RunQuiet("run-shell", "-b", "-t", client.PaneID(), closeScript(client.PaneID()))
			return 0
		}
	}
	// The launcher checks ownership before releasing its child gate, but a pane
	// can move after that shell check and before exec. Verify the stable owner
	// window again inside the binary before creating any long-lived state.
	if owner := os.Getenv(ownerWindowEnv); owner != "" {
		actual, err := client.PaneWindowID()
		if err != nil || actual != owner {
			// The pane moved after the launcher's final gate check. Clean only
			// the recorded source window; expected-owner guards prevent touching
			// any sidebar already present in the destination.
			client.RunQuiet("run-shell", "-b", "-t", client.PaneID(), closeScript(client.PaneID()))
			return 0
		}
	}
	// No alt screen: the sidebar owns a whole tmux pane for its lifetime, so
	// there is no prior screen content to preserve or restore, and staying on
	// the primary buffer keeps tmux's own copy-mode scrollback coherent.
	// All-motion reports hover without a pressed button; cell-motion would only
	// report drag events and cannot drive row hover styling.
	m := newModel(client)
	p := tea.NewProgram(m, tea.WithMouseAllMotion())
	// The signal worker is also explicitly stopped on an ordinary q/Esc exit.
	// m.Close cancels and joins every watcher/worker once Program.Run returns.
	done := make(chan struct{})
	defer close(done)
	defer m.Close()
	go func() {
		select {
		case <-hup:
			client.RunQuiet("run-shell", "-b", "-t", client.PaneID(), closeScript(client.PaneID()))
			p.Quit()
		case <-done:
		}
	}()
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "mm-sidebar: %v\n", err)
		return 1
	}
	return 0
}
