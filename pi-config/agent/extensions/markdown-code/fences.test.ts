import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import markdownCodeExtension from "./index.ts";
import { inferFenceLanguage, scanMarkdownFences, transformFencedMarkdown } from "./fences.ts";

const piCli = realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
const codingAgentRoot = resolve(dirname(piCli), "..", "..");
const codingAgentPath = resolve(codingAgentRoot, "dist", "index.js");
const tuiPath = resolve(codingAgentRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "index.js");
const { getMarkdownTheme, initTheme } = await import(pathToFileURL(codingAgentPath).href);
const syntaxHighlightPath = resolve(codingAgentRoot, "dist", "utils", "syntax-highlight.js");
const { loadAllHighlightLanguages } = await import(pathToFileURL(syntaxHighlightPath).href);
const { Markdown, visibleWidth } = await import(pathToFileURL(tuiPath).href);
const jitiPath = resolve(codingAgentRoot, "node_modules", "jiti", "lib", "jiti.mjs");
const { createJiti } = await import(pathToFileURL(jitiPath).href);
const jiti = createJiti(import.meta.url, {
	fsCache: false,
	moduleCache: false,
	alias: {
		"@earendil-works/pi-coding-agent": codingAgentPath,
		"@earendil-works/pi-tui": tuiPath,
	},
});
const { renderMarkdownBlock, renderFileContent } = await jiti.import(resolve(import.meta.dirname, "../pretty/src/render.ts")) as {
	renderMarkdownBlock: (code: string, theme: unknown) => string[];
	renderFileContent: (content: string, filePath: string, offset: number, maxLines: number, width: number, theme: unknown) => Promise<string>;
};
const { registerReadTool } = await jiti.import(resolve(import.meta.dirname, "../pretty/src/tools/read.ts")) as {
	registerReadTool: (...args: any[]) => void;
};

process.env.PI_CODING_AGENT_DIR ??= resolve(import.meta.dirname, "../..");
initTheme("active", false);
await loadAllHighlightLanguages();

const markdownTheme = getMarkdownTheme();
const previewTheme = {
	fg: (key: string, text: string) => ((markdownTheme as Record<string, unknown>)[key.slice(2, 3).toLowerCase() + key.slice(3)] as ((value: string) => string) | undefined)?.(text) ?? text,
	bold: (text: string) => markdownTheme.bold(text),
};
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const foregrounds = (text: string | undefined) => new Set(text?.match(/\x1b\[38;2;[0-9;]*m/g) ?? []);
const hasTokenColors = (text: string | undefined) => foregrounds(text).size > 1;

const fixtures = [
	["javascript", "const message = \"hello\";\nconsole.log(message);", "javascript"],
	["typescript", "interface User { name: string }\nconst user: User = { name: \"Ada\" };", "typescript"],
	["python", "def greet(name):\n    return f\"hello {name}\"", "python"],
	["bash", "#!/usr/bin/env bash\nset -euo pipefail\necho \"hello\"", "bash"],
	["json", "{\n  \"enabled\": true,\n  \"count\": 2\n}", "json"],
] as const;

test("conservatively infers common fenced-code languages", () => {
	for (const [name, code, expected] of fixtures) assert.equal(inferFenceLanguage(code), expected, name);
	for (const code of ["ordinary prose about a plan", "2026-09-14 service started", "foo bar baz", "GET /health 200"]) {
		assert.equal(inferFenceLanguage(code), undefined, code);
	}
});

test("scanner preserves delimiters, source text, CRLF, nested quotes, and open streaming fences", () => {
	const markdown = [
		"before",
		"> ```",
		"> const value = `literal`;",
		"> ```",
		"",
		"~~~~python",
		"# not a Markdown heading",
		"print(`value`)",
		"~~~~",
		"```",
		"def open_block():",
		"    return True",
	].join("\r\n");
	const blocks = scanMarkdownFences(markdown);
	assert.equal(blocks.length, 3);
	assert.equal(blocks[0]?.language, "javascript");
	assert.equal(blocks[0]?.closed, true);
	assert.equal(blocks[1]?.explicitLanguage, "python");
	assert.equal(blocks[2]?.language, "python");
	assert.equal(blocks[2]?.closed, false);
	const transformed = transformFencedMarkdown(markdown);
	assert.ok(transformed.includes("> ```javascript\r\n> const value = `literal`;"));
	assert.ok(transformed.includes("~~~~python\r\n# not a Markdown heading"));
	assert.ok(transformed.endsWith("```python\r\ndef open_block():\r\n    return True"));
	assert.equal(
		transformFencedMarkdown("- item\n  ```\n  const nested = true;\n  ```"),
		"- item\n  ```javascript\n  const nested = true;\n  ```",
	);
});

test("mismatched blockquote containers do not close a fenced block", () => {
	const source = "> ```\n> const value = true;\n```\n# still quoted code";
	const [fence] = scanMarkdownFences(source);
	assert.equal(fence?.closed, false);
	assert.equal(fence?.bodyEndLine, 4);
	const transformed = transformFencedMarkdown(source);
	assert.match(transformed, /^> ```javascript/);
	assert.equal(transformFencedMarkdown(transformed), transformed);
});

test("a list-nested fence is not closed by a root-level fence", () => {
	const source = "- item\n  ```\n  const nested = true;\n```\n# still nested code";
	const [fence] = scanMarkdownFences(source);
	assert.equal(fence?.closed, false);
	assert.equal(fence?.bodyEndLine, 5);
	const rendered = renderMarkdownBlock(source, previewTheme);
	assert.equal(stripAnsi(rendered[4]!), "# still nested code");
});

test("explicit languages win and plaintext or unsupported tags stay unchanged", () => {
	assert.equal(transformFencedMarkdown("```python\nconst x = 1;\n```"), "```python\nconst x = 1;\n```");
	assert.equal(transformFencedMarkdown("```text\nconst x = 1;\n```"), "```text\nconst x = 1;\n```");
	assert.equal(transformFencedMarkdown("```unknown-lang\nconst x = 1;\n```"), "```unknown-lang\nconst x = 1;\n```");
});

test("extension transforms user and assistant Markdown, including streaming updates", () => {
	let transformer: ((markdown: string, context: { messageType: string; isStreaming: boolean; availableWidth: number }) => string) | undefined;
	markdownCodeExtension({ registerMarkdownTransformer(value: typeof transformer) { transformer = value; } } as never);
	assert.ok(transformer);
	for (const messageType of ["user", "assistant"] as const) {
		for (const isStreaming of [false, true]) {
			assert.match(transformer!("```\nconst x = 1;\n```", { messageType, isStreaming, availableWidth: 80 }), /^```javascript/);
		}
	}
});

test("actual Pi Markdown rendering gives tagged and recognizable bare fences token colors", () => {
	for (const [, code, language] of fixtures) {
		for (const info of [language, ""]) {
			const source = transformFencedMarkdown(`\`\`\`${info}\n${code}\n\`\`\``);
			const lines = new Markdown(source, 0, 0, getMarkdownTheme()).render(120);
			const codeLines = lines.filter((line: string) => code.split("\n").some((sourceLine) => sourceLine.trim() && stripAnsi(line).includes(sourceLine.trim())));
			assert.ok(hasTokenColors(codeLines.join("")), `${language}/${info || "bare"}: ${codeLines.join(" | ")}`);
		}
	}
});

test("Markdown read rendering preserves fenced source and bypasses inline Markdown parsing", async () => {
	const source = ["# prose heading", "```typescript", "# not a heading", "const pattern = \"`literal`\";", "- not a list", "```", "after **bold**"].join("\n");
	const rendered = renderMarkdownBlock(source, previewTheme);
	assert.equal(rendered.length, source.split("\n").length);
	assert.deepEqual(rendered.slice(0, 6).map(stripAnsi), source.split("\n").slice(0, 6));
	assert.equal(stripAnsi(rendered[6]!), "after bold");
	assert.ok(hasTokenColors(rendered.slice(2, 5).join("")));
	const mismatchedQuote = renderMarkdownBlock("> ```\n> const value = true;\n```\n# still quoted code", previewTheme);
	assert.equal(stripAnsi(mismatchedQuote[3]!), "# still quoted code");
	for (const width of [24, 120]) {
		const preview = await renderFileContent(source, "README.md", 0, 100, width, previewTheme);
		const rows = preview.split("\n");
		assert.equal(rows.length, source.split("\n").length);
		for (const row of rows) assert.ok(visibleWidth(row) <= width, `${visibleWidth(row)} > ${width}`);
	}
});

test("collapsed Markdown read highlighting settles without an invalidate loop", async () => {
	class FakeText {
		value = "";
		setText(value: string) { this.value = value; }
		render() { return this.value.split("\n"); }
		invalidate() {}
	}
	let definition: any;
	registerReadTool(
		{ registerTool(value: unknown) { definition = value; } },
		process.cwd(),
		null,
		{ parameters: {}, description: "read", async execute() { throw new Error("unused"); } },
		FakeText,
	);
	const source = "```typescript\nconst value: number = 1;\n```\nafter";
	const result = { content: [{ type: "text", text: source }], details: { _type: "readFile", filePath: "README.md", content: source, offset: 0, lineCount: 4 } };
	let invalidations = 0;
	const context: any = { state: {}, expanded: false, isError: false, invalidate() { invalidations++; } };
	const component = definition.renderResult(result, {}, previewTheme, context);
	component.render(80);
	await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
	assert.equal(invalidations, 1);
	context.lastComponent = component;
	definition.renderResult(result, {}, previewTheme, context).render(80);
	await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
	assert.equal(invalidations, 1);
	assert.ok(hasTokenColors(component.value));
	const alternateTheme = {
		...previewTheme,
		fg: (key: string, text: string) => key.startsWith("md") ? `\x1b[38;2;1;2;3m${text}\x1b[39m` : previewTheme.fg(key, text),
	};
	definition.renderResult(result, {}, alternateTheme, context).render(80);
	await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
	assert.equal(invalidations, 2);
	assert.match(component.value, /\x1b\[38;2;1;2;3m```typescript/);
});

test("plain and unknown fenced code stays readable without fabricated token colors", () => {
	for (const language of ["text", "unknown-lang"]) {
		const lines = renderMarkdownBlock(`\`\`\`${language}\nordinary prose about a plan\n\`\`\``, previewTheme);
		assert.equal(stripAnsi(lines[1]!), "ordinary prose about a plan");
		assert.ok(foregrounds(lines[1]).size <= 1);
	}
});
