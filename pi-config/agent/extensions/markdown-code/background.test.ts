import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { agent, tui, jiti, themeModule } from "./test-runtime.mjs";

const { default: extension } = await jiti.import(resolve(import.meta.dirname, "index.ts"));
agent.initTheme("active", false);
const { Markdown, visibleWidth } = tui;
const { AssistantMessageComponent, getMarkdownTheme } = agent;
const strip = (text: string) => text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;]*m/g, "");

function start() {
	const events: Record<string, Function> = {};
	const transformers: Function[] = [];
	extension({ on(name: string, callback: Function) { events[name] = callback; }, registerMarkdownTransformer(callback: Function) { transformers.push(callback); } });
	events.session_start?.({}, { mode: "tui", ui: { get theme() { return themeModule.theme; } } });
	return { transformers, stop: () => events.session_shutdown?.({}) };
}
function message(text: string) {
	return { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" };
}
function component(text: string, transformers: Function[]) {
	return new AssistantMessageComponent(message(text), false, getMarkdownTheme(), "Thinking...", 1, transformers);
}
// Inspect every displayed cell, not just whether a row contains some background ANSI.
function backgrounds(row: string) {
	let background = "default";
	const cells: string[] = [];
	for (const part of row.split(/(\x1b\[[0-9;]*m|\x1b\][^\x07]*(?:\x07|\x1b\\))/g)) {
		if (part.startsWith("\x1b]")) continue;
		if (part.startsWith("\x1b[")) {
			const values = part.slice(2, -1).split(";").map(Number);
			for (let i = 0; i < values.length; i++) {
				const value = values[i];
				if (value === 0 || value === 49) background = "default";
				if (value === 38 || value === 48) {
					const end = i + (values[i + 1] === 2 ? 5 : 3);
					if (value === 48) background = `\x1b[${values.slice(i, end).join(";")}m`;
					i = end - 1;
				}
			}
		} else {
			for (const char of part) for (let i = 0; i < visibleWidth(char); i++) cells.push(background);
		}
	}
	return { cells, end: background };
}
function assertPanel(rows: string[], width: number, left = 1) {
	const expected = themeModule.theme.getBgAnsi("toolPendingBg");
	for (const row of rows) {
		assert.equal(visibleWidth(row), width);
		const { cells, end } = backgrounds(row);
		assert.deepEqual(cells.slice(0, left), Array(left).fill("default"), "left margin");
		assert.deepEqual(cells.slice(left, width - 1), Array(width - left - 1).fill(expected), `unfilled block cells: ${strip(row)}`);
		assert.equal(cells[width - 1], "default", "right margin");
		assert.equal(end, "default", "background leaks beyond row");
	}
}

test("assistant fenced blocks fill fences, body, blanks, and wrapped lines without coloring prose", () => {
	const runtime = start();
	try {
		for (const tag of ["javascript", "", "text", "unknown-lang"]) {
			for (const width of [24, 80, 120]) {
				const source = `Before with \`inline\`.\n\n\`\`\`${tag}\nconst message = "a long string of words that will wrap at narrow widths";\n\nconsole.log(message);\n\`\`\`\nAfter.`;
				const rows = component(source, runtime.transformers).render(width);
				const first = rows.findIndex((row: string) => strip(row).trim().startsWith("```"));
				const last = rows.findIndex((row: string, index: number) => index > first && strip(row).trim() === "```");
				assert.ok(first >= 0 && last > first);
				assertPanel(rows.slice(first, last + 1), width);
				for (const row of [...rows.slice(0, first), ...rows.slice(last + 1)]) assert.ok(backgrounds(row).cells.every((cell) => cell === "default"));
			}
		}
	} finally { runtime.stop(); }
});

test("empty, tilde, streaming, list, and quote fences keep a rectangular panel on resize", () => {
	const runtime = start();
	try {
		for (const [source, left] of [
			["```\n```", 1],
			["~~~text\nplain\n~~~", 1],
			["```javascript\nconst x = 1;\n`", 1],
			["- item\n  ```js\n  const x = \"nested words that wrap across the small terminal\";\n  ```", 3],
			["> ```js\n> const x = \"quoted words that wrap across the small terminal\";\n> ```", 3],
			["> - item\n>   ```text\n>   界界界 combining é\n>   ```", 5],
		] as const) {
			const view = component(source, runtime.transformers);
			view.updateContent(message(source), true);
			for (const width of [80, 24, 120]) {
				const rows = view.render(width);
				const panel = rows.filter((row: string) => row.includes(themeModule.theme.getBgAnsi("toolPendingBg")));
				assert.ok(panel.length >= 3, source);
				assertPanel(panel, width, left);
				assert.ok(rows.every((row: string) => visibleWidth(row) <= width));
			}
			view.updateContent(message("```js\nconst done = true;\n```\nFinished."), false);
			assertPanel(view.render(80).filter((row: string) => row.includes(themeModule.theme.getBgAnsi("toolPendingBg"))), 80);
		}
	} finally { runtime.stop(); }
});

test("user, thinking, tool Markdown, inline, and indented code remain native", () => {
	const source = "```js\nconst x = 1;\n```";
	const runtime = start();
	try {
		for (const messageType of ["user", "assistant-thinking"]) {
			const style = messageType === "user" ? { bgColor: (text: string) => themeModule.theme.bg("userMessageBg", text) } : undefined;
			const transform = (text: string, availableWidth: number) => runtime.transformers.reduce((text, transformer) => transformer(text, { messageType, availableWidth, isStreaming: false }), text);
			const actual = new Markdown(source, 1, 0, getMarkdownTheme(), style, { transform }).render(80);
			const expected = new Markdown(source, 1, 0, getMarkdownTheme(), style).render(80);
			assert.deepEqual(actual, expected, messageType);
		}
		assert.ok(new Markdown(source, 0, 0, getMarkdownTheme()).render(80).every((row: string) => !row.includes("\x1b[48;")));
		const view = new AssistantMessageComponent({ ...message("An `inline` example.\n\n    const indented = true;"), content: [
			{ type: "thinking", thinking: source }, ...message("An `inline` example.\n\n    const indented = true;").content,
		] }, false, getMarkdownTheme(), "Thinking...", 1, runtime.transformers);
		assert.ok(view.render(80).every((row: string) => !row.includes("\x1b[48;")));
	} finally { runtime.stop(); }
});

test("native syntax foregrounds and content survive background fill, including resets", async () => {
	const runtime = start();
	try {
		const source = "```js\nconst text = \"hello\";\n```";
		const actual = component(source, runtime.transformers).render(80);
		const native = component(source, []).render(80);
		const removeBackground = (rows: string[]) => rows.map((row) => row.replace(/\x1b\[(?:48;[0-9;]+|49)m/g, ""));
		assert.deepEqual(removeBackground(actual), native);
		const customTheme = { ...getMarkdownTheme(), highlightCode: () => ["one\x1b[0mtwo\x1b[49mthree"] };
		const view = new AssistantMessageComponent(message(source), false, customTheme, "Thinking...", 1, runtime.transformers);
		assertPanel(view.render(80).slice(1), 80);
	} finally { runtime.stop(); }
});

test("reload, disable, and theme invalidation clear cached backgrounds without stacking", () => {
	const first = start();
	const source = "```text\nhello\n```";
	const view = component(source, first.transformers);
	const before = view.render(80);
	assertPanel(before.slice(1), 80);
	assert.deepEqual(view.render(80), before);
	const second = start();
	first.stop(); // A stale cleanup must not disable the replacement extension.
	try {
		assert.deepEqual(view.render(80), before);
		agent.initTheme("light", false);
		view.invalidate();
		assertPanel(view.render(80).slice(1), 80);
		assert.notDeepEqual(view.render(80), before);
		second.stop();
		assert.ok(view.render(80).every((row: string) => !row.includes("\x1b[48;")));
	} finally {
		second.stop();
		agent.initTheme("active", false);
	}
});
