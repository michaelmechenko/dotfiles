import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FRAMES = ["*  ", "** ", "***", "** "];

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setWorkingIndicator({
			frames: FRAMES.map((frame) => ctx.ui.theme.fg("accent", frame)),
			intervalMs: 1500,
		});
	});
}
