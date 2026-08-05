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

	tea "github.com/charmbracelet/bubbletea"

	"mm-sidebar/internal/agents"
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
  agents        print one TSV row per live agent pane (9 fields) and exit
`)
}

// runAgents prints the 9-field TSV schema. --tsv is accepted and ignored: it is
// the only output format, and spelling it out keeps the tmux-agent-ls wrapper
// self-documenting.
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
	// No alt screen: the sidebar owns a whole tmux pane for its lifetime, so
	// there is no prior screen content to preserve or restore, and staying on
	// the primary buffer keeps tmux's own copy-mode scrollback coherent.
	p := tea.NewProgram(newModel(), tea.WithMouseCellMotion())
	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "mm-sidebar: %v\n", err)
		return 1
	}
	return 0
}
