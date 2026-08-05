package blocks

import (
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"mm-sidebar/internal/theme"
)

// SystemStatsMsg is one sampled reading of machine load.
type SystemStatsMsg struct {
	CPU  int // percent of all threads
	Mem  int // percent used (approximate; see sampleMem)
	Disk int // percent of / used
	Batt int // percent, -1 when absent (desktop / no battery reported)
}

// SystemStats is the read-only cpu/mem/disk/battery glance -- the piece of
// agent-manager's persistent "computer" panel this sidebar adopted.
//
// It reuses the measurement commands already trusted elsewhere in this repo
// rather than inventing a new approach: CPU via the same core-count-normalized
// `ps -eo pcpu` sum as sketchybar/plugins/cpu.sh, battery via the same
// `pmset -g batt` parse as sketchybar/plugins/battery.sh, disk via `df -H /`,
// memory via vm_stat page counts against hw.memsize.
type SystemStats struct {
	theme theme.Theme
	have  bool
	stats SystemStatsMsg
}

func NewSystemStats(th theme.Theme) *SystemStats {
	return &SystemStats{theme: th, stats: SystemStatsMsg{Batt: -1}}
}

func (b *SystemStats) ID() string { return "system_stats" }

// Interval is deliberately slower than the navigator's: machine load doesn't
// need per-keystroke or even per-2s freshness, and the `ps -eo pcpu` sample is
// the priciest recurring call in this binary.
func (b *SystemStats) Interval() time.Duration { return 5 * time.Second }

// Fetch samples off the input path. Unlike agents_glance this holds no mutable
// cache, so a plain concurrent Cmd is safe -- there is nothing to race on.
func (b *SystemStats) Fetch() tea.Cmd {
	return func() tea.Msg {
		return SystemStatsMsg{
			CPU:  sampleCPU(),
			Mem:  sampleMem(),
			Disk: sampleDisk(),
			Batt: sampleBattery(),
		}
	}
}

func (b *SystemStats) Update(msg tea.Msg) {
	if m, ok := msg.(SystemStatsMsg); ok {
		b.stats, b.have = m, true
	}
}

// gaugeWidth is the bar's cell count: 4 (label) + 1 + 20 (bar) + 1 + 4 ("100%")
// = 30 cells, inside the 36-column pane. Fixed rather than width-reactive; clip
// handles a narrower pane.
const gaugeWidth = 20

// Height: label + one gauge line per metric (battery omitted when absent).
func (b *SystemStats) Height() int {
	h := 4 // label + cpu + mem + disk
	if !b.have || b.stats.Batt >= 0 {
		h++
	}
	return h
}

func (b *SystemStats) View(width int) string {
	lines := []string{label(b.theme.Accent, "system")}
	if !b.have {
		for len(lines) < b.Height() {
			lines = append(lines, b.theme.Muted.Render("sampling…"))
		}
		return join(lines, width)
	}
	s := b.stats
	lines = append(lines,
		b.gauge("cpu", s.CPU, s.CPU >= 85),
		b.gauge("mem", s.Mem, s.Mem >= 85),
		b.gauge("disk", s.Disk, s.Disk >= 85),
	)
	if s.Batt >= 0 {
		lines = append(lines, b.gauge("batt", s.Batt, s.Batt <= 20))
	}
	return join(lines, width)
}

// gauge renders "labl ▓▓▓░░… NN%": fill in the accent (rose when hot -- high
// load, or a LOW battery), track in the divider-subtle role so it reads as
// background, value in the ordinary row-text style.
func (b *SystemStats) gauge(name string, val int, hot bool) string {
	for len(name) < 4 {
		name += " "
	}
	fill := val * gaugeWidth / 100
	// Floor a nonzero reading at one cell: at 20 cells anything under 5% rounds
	// to an all-track bar indistinguishable from 0, which also drops the hot/low
	// color entirely -- exactly backwards for a 4% battery.
	if fill == 0 && val > 0 {
		fill = 1
	}
	fillStyle := b.theme.Accent
	if hot {
		fillStyle = b.theme.Urgent
	}
	return b.theme.Muted.Render(name) + " " +
		fillStyle.Render(strings.Repeat("▓", fill)) +
		b.theme.Divider.Render(strings.Repeat("░", gaugeWidth-fill)) + " " +
		b.theme.Text.Render(pct(val))
}

func pct(n int) string { return strconv.Itoa(n) + "%" }

// sampleCPU sums every process's %CPU and normalizes by thread count, matching
// sketchybar/plugins/cpu.sh. Like that script it can exceed 100 briefly on a
// sampling artifact, so the result is clamped for display.
func sampleCPU() int {
	cores := 1
	if out, err := exec.Command("sysctl", "-n", "machdep.cpu.thread_count").Output(); err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(string(out))); err == nil && n > 0 {
			cores = n
		}
	}
	out, err := exec.Command("ps", "-eo", "pcpu=").Output()
	if err != nil {
		return 0
	}
	sum := 0.0
	for _, line := range strings.Split(string(out), "\n") {
		if v, err := strconv.ParseFloat(strings.TrimSpace(line), 64); err == nil {
			sum += v
		}
	}
	return clampPct(int(sum/float64(cores) + 0.5))
}

var vmStatPages = regexp.MustCompile(`(?m)^Pages (free|inactive):\s+(\d+)`)

// sampleMem approximates used memory as 1 - (free+inactive)/total. Approximate
// by design: it is a glance, not an Activity Monitor replacement.
func sampleMem() int {
	totalOut, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
	if err != nil {
		return 0
	}
	total, err := strconv.ParseInt(strings.TrimSpace(string(totalOut)), 10, 64)
	if err != nil || total <= 0 {
		return 0
	}
	out, err := exec.Command("vm_stat").Output()
	if err != nil {
		return 0
	}
	text := string(out)
	pageSize := int64(4096)
	if m := regexp.MustCompile(`page size of (\d+) bytes`).FindStringSubmatch(text); len(m) == 2 {
		if n, err := strconv.ParseInt(m[1], 10, 64); err == nil && n > 0 {
			pageSize = n
		}
	}
	var pages int64
	for _, m := range vmStatPages.FindAllStringSubmatch(text, -1) {
		if n, err := strconv.ParseInt(m[2], 10, 64); err == nil {
			pages += n
		}
	}
	return clampPct(int(100 - (pages*pageSize*100)/total))
}

// dataVolume is the APFS data volume. On a modern macOS install `/` is the
// sealed, read-only system volume and everything a user actually fills up lives
// here, so `df /` is not a usable "disk full" gauge -- measured on this machine,
// `/` reports 5% while the data volume reports 48%. The bash sidebar used
// `df -H /` and therefore showed 5%, which is not a rounding difference from the
// truth, it's the wrong number. Falls back to "/" if the path is absent (older
// macOS, or a non-APFS root).
const dataVolume = "/System/Volumes/Data"

// sampleDisk reads the Capacity column of `df -H`.
func sampleDisk() int {
	target := dataVolume
	if _, err := os.Stat(target); err != nil {
		target = "/"
	}
	out, err := exec.Command("df", "-H", target).Output()
	if err != nil {
		return 0
	}
	lines := strings.Split(strings.TrimRight(string(out), "\n"), "\n")
	if len(lines) < 2 {
		return 0
	}
	f := strings.Fields(lines[1])
	if len(f) < 5 {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimSuffix(f[4], "%"))
	if err != nil {
		return 0
	}
	return clampPct(n)
}

var battPct = regexp.MustCompile(`(\d+)%`)

// sampleBattery returns -1 when no percentage is reported, so View can omit the
// field entirely instead of showing a misleading 0%.
func sampleBattery() int {
	out, err := exec.Command("pmset", "-g", "batt").Output()
	if err != nil {
		return -1
	}
	m := battPct.FindStringSubmatch(string(out))
	if len(m) != 2 {
		return -1
	}
	n, err := strconv.Atoi(m[1])
	if err != nil {
		return -1
	}
	return clampPct(n)
}

func clampPct(n int) int {
	if n < 0 {
		return 0
	}
	if n > 100 {
		return 100
	}
	return n
}
