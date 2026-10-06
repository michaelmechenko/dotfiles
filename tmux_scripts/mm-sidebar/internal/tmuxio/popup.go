package tmuxio

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	minPreviewWidth  = 32
	minPreviewHeight = 8
	maxPreviewWidth  = 100
)

// PopupGeometry is client-relative. X/Y include the top status-line offset
// because display-popup positions against the client, while pane_left is
// window-relative.
type PopupGeometry struct {
	X, Y          int
	Width, Height int
}

// PreviewPopupRequest captures the logical preview identity. Geometry is
// deliberately not captured: preflight queries the sidebar's current pane_left
// and pane_width immediately before a popup can be launched.
type PreviewPopupRequest struct {
	OwnerWindow  string
	Binary, Path string
}

// PreviewPopupResult reports whether callers should use their existing local
// modal instead. A narrow client or a zoomed window is not an error: a popup
// would either hide the sidebar relationship or have no useful space.
type PreviewPopupResult struct {
	Fallback bool
}

// PreviewPopupPlan contains no side effect. Model code must validate its own
// request generation before calling LaunchPathPreview.
type PreviewPopupPlan struct {
	request  PreviewPopupRequest
	geometry PopupGeometry
}

var popupStateTokens = []string{
	"#{q/a:window_id}",
	"#{q/a:popup_width}",
	"#{q/a:client_width}",
	"#{q/a:client_height}",
	"#{q/a:status}",
	"#{q/a:status-position}",
	"#{q/a:window_zoomed_flag}",
}

var popupPaneTokens = []string{
	"#{q/a:window_id}",
	"#{q/a:pane_left}",
	"#{q/a:pane_width}",
}

// PreviewPopupGeometry derives a full-height preview immediately left of the
// right sidebar. It does not alter the window layout or create a pane.
func PreviewPopupGeometry(clientWidth, clientHeight, status int, statusPosition string, sidebarLeft, sidebarWidth int, zoomed bool) (PopupGeometry, bool) {
	if zoomed || clientWidth <= 0 || clientHeight <= 0 || sidebarLeft < minPreviewWidth || sidebarWidth <= 0 {
		return PopupGeometry{}, false
	}
	// A client smaller than the server's window can have the right sidebar
	// outside its visible viewport. Do not place a detached-looking popup.
	if sidebarLeft+sidebarWidth > clientWidth {
		return PopupGeometry{}, false
	}
	height := clientHeight - status
	if height < minPreviewHeight {
		return PopupGeometry{}, false
	}
	width := sidebarLeft
	if width > maxPreviewWidth {
		width = maxPreviewWidth
	}
	if width < minPreviewWidth {
		return PopupGeometry{}, false
	}
	y := 0
	if status > 0 && statusPosition == "top" {
		y = status
	}
	return PopupGeometry{X: sidebarLeft - width, Y: y, Width: width, Height: height}, true
}

// PreparePathPreview performs only the current tmux state reads. It is safe to
// run before the model accepts a completion; it never opens a popup.
func (c *Client) PreparePathPreview(ctx context.Context, req PreviewPopupRequest) (PreviewPopupPlan, PreviewPopupResult, error) {
	if c == nil || c.paneID == "" || c.originClient == "" || req.OwnerWindow == "" {
		return PreviewPopupPlan{}, PreviewPopupResult{Fallback: true}, nil
	}
	if req.Path == "" || strings.IndexByte(req.Path, 0) >= 0 {
		return PreviewPopupPlan{}, PreviewPopupResult{}, fmt.Errorf("tmuxio: invalid preview path")
	}
	if !filepath.IsAbs(req.Binary) || strings.IndexByte(req.Binary, 0) >= 0 {
		return PreviewPopupPlan{}, PreviewPopupResult{}, fmt.Errorf("tmuxio: invalid preview binary")
	}
	paneState, err := c.popupPaneState(ctx)
	if err != nil {
		return PreviewPopupPlan{}, PreviewPopupResult{}, err
	}
	if paneState.window != req.OwnerWindow {
		return PreviewPopupPlan{}, PreviewPopupResult{Fallback: true}, nil
	}
	state, err := c.popupClientState(ctx)
	if err != nil {
		return PreviewPopupPlan{}, PreviewPopupResult{}, err
	}
	if state.window != req.OwnerWindow {
		return PreviewPopupPlan{}, PreviewPopupResult{Fallback: true}, nil
	}
	if state.popupWidth != 0 {
		return PreviewPopupPlan{}, PreviewPopupResult{}, fmt.Errorf("tmuxio: another popup is already open")
	}
	geometry, ok := PreviewPopupGeometry(state.clientWidth, state.clientHeight, state.status, state.statusPosition, paneState.left, paneState.width, state.zoomed)
	if !ok {
		return PreviewPopupPlan{}, PreviewPopupResult{Fallback: true}, nil
	}
	return PreviewPopupPlan{request: req, geometry: geometry}, PreviewPopupResult{}, nil
}

// LaunchPathPreview repeats the cheap preflight. The second guard closes the
// gap between model acceptance and the side effect; a cancelled request never
// reaches display-popup.
func (c *Client) LaunchPathPreview(ctx context.Context, plan PreviewPopupPlan) (PreviewPopupResult, error) {
	if err := ctx.Err(); err != nil {
		return PreviewPopupResult{}, err
	}
	current, result, err := c.PreparePathPreview(ctx, plan.request)
	if err != nil || result.Fallback {
		return result, err
	}
	if err := ctx.Err(); err != nil {
		return PreviewPopupResult{}, err
	}
	geometry := current.geometry
	_, err = c.commandContext(ctx,
		"display-popup", "-c", c.originClient, "-t", c.paneID, "-E",
		"-x", strconv.Itoa(geometry.X), "-y", strconv.Itoa(geometry.Y),
		"-w", strconv.Itoa(geometry.Width), "-h", strconv.Itoa(geometry.Height),
		"-e", "MM_SIDEBAR_PREVIEW_PATH="+plan.request.Path,
		plan.request.Binary, "preview",
	)
	if err != nil {
		return PreviewPopupResult{}, fmt.Errorf("tmuxio: open preview popup: %w", err)
	}
	return PreviewPopupResult{}, nil
}

type popupPaneState struct {
	window      string
	left, width int
}

func (c *Client) popupPaneState(ctx context.Context) (popupPaneState, error) {
	out, err := c.commandContext(ctx, "display-message", "-p", "-t", c.paneID, strings.Join(popupPaneTokens, fieldSep))
	if err != nil {
		return popupPaneState{}, fmt.Errorf("tmuxio: preview sidebar lookup: %w", err)
	}
	fields, err := decodeFields(out, len(popupPaneTokens))
	if err != nil {
		return popupPaneState{}, fmt.Errorf("tmuxio: preview sidebar state: %w", err)
	}
	left, err := parseInt("pane_left", fields[1])
	if err != nil {
		return popupPaneState{}, err
	}
	width, err := parseInt("pane_width", fields[2])
	if err != nil {
		return popupPaneState{}, err
	}
	return popupPaneState{window: fields[0], left: left, width: width}, nil
}

type popupClientState struct {
	window, statusPosition                string
	popupWidth, clientWidth, clientHeight int
	status                                int
	zoomed                                bool
}

func (c *Client) popupClientState(ctx context.Context) (popupClientState, error) {
	out, err := c.commandContext(ctx, "display-message", "-p", "-c", c.originClient, strings.Join(popupStateTokens, fieldSep))
	if err != nil {
		return popupClientState{}, fmt.Errorf("tmuxio: preview client lookup: %w", err)
	}
	fields, err := decodeFields(out, len(popupStateTokens))
	if err != nil {
		return popupClientState{}, fmt.Errorf("tmuxio: preview client state: %w", err)
	}
	popupWidth, err := parseInt("popup_width", emptyNumber(fields[1]))
	if err != nil {
		return popupClientState{}, err
	}
	clientWidth, err := parseInt("client_width", fields[2])
	if err != nil {
		return popupClientState{}, err
	}
	clientHeight, err := parseInt("client_height", fields[3])
	if err != nil {
		return popupClientState{}, err
	}
	status, err := parseStatus(fields[4])
	if err != nil {
		return popupClientState{}, err
	}
	return popupClientState{window: fields[0], popupWidth: popupWidth, clientWidth: clientWidth, clientHeight: clientHeight, status: status, statusPosition: fields[5], zoomed: fields[6] == "1"}, nil
}

// status is a textual tmux option ("on" or "off"), unlike the numeric
// geometry formats around it. Accept numeric values too for old servers and
// test doubles which expose the option as a boolean integer.
func parseStatus(value string) (int, error) {
	switch value {
	case "on":
		return 1, nil
	case "off", "":
		return 0, nil
	default:
		return parseInt("status", value)
	}
}

func emptyNumber(value string) string {
	if value == "" {
		return "0"
	}
	return value
}
