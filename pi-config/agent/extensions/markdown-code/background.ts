import { Markdown, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const PATCH = Symbol.for("pi.markdown-code.background.v1");

type Background = (text: string) => string;
type Token = { type: string; raw?: string };
type Frame = { markdown: Markdown; assistant: boolean };
interface Adapter {
	frame?: Frame;
	generation: number;
	decorate?: (rows: string[], width: number) => string[];
}

// Pi has no code-block background hook. Keep the private seam confined to
// renderToken, and use the public transformer context to identify assistant
// text (not user messages, thinking, or arbitrary Markdown in tool previews).
function adapter(): Adapter | undefined {
	return (Markdown.prototype as any)[PATCH];
}

export function selectCodeBackground(messageType: string): void {
	const frame = adapter()?.frame;
	if (frame) frame.assistant = messageType === "assistant";
}

export function installCodeBackground(background: Background): () => void {
	const prototype = Markdown.prototype as any;
	if (typeof prototype.render !== "function" || typeof prototype.renderToken !== "function") {
		console.warn("[markdown-code] Markdown renderer changed; code backgrounds disabled.");
		return () => {};
	}
	let state = adapter();
	if (!state) {
		state = { generation: 0 };
		prototype[PATCH] = state;
		const shared = state;
		const generations = new WeakMap<Markdown, number>();
		const render = prototype.render;
		const renderToken = prototype.renderToken;
		prototype.render = function (width: number): string[] {
			// Clear native caches on enable/disable/reload, including old instances.
			if (generations.get(this) !== shared.generation) {
				this.invalidate();
				generations.set(this, shared.generation);
			}
			const previous = shared.frame;
			shared.frame = { markdown: this, assistant: false };
			try { return render.call(this, width); }
			finally { shared.frame = previous; }
		};
		prototype.renderToken = function (token: Token, width: number, ...rest: unknown[]): string[] {
			const rows = renderToken.call(this, token, width, ...rest);
			if (!shared.decorate || shared.frame?.markdown !== this || !shared.frame.assistant
				|| token.type !== "code" || !/^ {0,3}(?:`{3,}|~{3,})/.test(token.raw ?? "")) return rows;
			try {
				// Pi may append an empty separator after the closing fence. It is
				// outside the block; blank *body* lines have Pi's code indent/style.
				const separator = rows.at(-1) === "";
				const block = separator ? rows.slice(0, -1) : rows;
				const decorated = shared.decorate(block, width);
				return separator ? [...decorated, ""] : decorated;
			} catch {
				return rows; // A decoration failure must not hide the native content.
			}
		};
	}
	// Refresh the implementation/closure rather than stacking patches on /reload.
	const decorate = (rows: string[], width: number) => rows.flatMap((row) =>
		wrapTextWithAnsi(row, width).map((line) => {
			const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
			// Syntax styles may contain full/background resets. Reapply the panel
			// after those resets; foreground-only resets must remain untouched.
			const prefix = background("").replace(/\x1b\[49m$/, "");
			return background(padded.replace(/\x1b\[(?:0|49)?m/g, (reset) => reset + prefix));
		}));
	state.decorate = decorate;
	state.generation++;
	return () => {
		if (state.decorate !== decorate) return;
		state.decorate = undefined;
		state.generation++;
	};
}
