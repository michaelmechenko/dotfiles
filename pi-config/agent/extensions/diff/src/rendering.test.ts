import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const piCli = realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
const codingAgentRoot = resolve(dirname(piCli), "..", "..");
const codingAgentPath = resolve(codingAgentRoot, "dist", "index.js");
const tuiPath = resolve(codingAgentRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "index.js");
const jitiPath = resolve(codingAgentRoot, "node_modules", "jiti", "lib", "jiti.mjs");
const { createJiti } = await import(pathToFileURL(jitiPath).href);
const sdk = await import(pathToFileURL(codingAgentPath).href);
const { stripTerminalSequences, visibleWidth } = await import(pathToFileURL(tuiPath).href);
const jiti = createJiti(import.meta.url, {
	fsCache: false,
	moduleCache: false,
	alias: {
		"@earendil-works/pi-coding-agent": codingAgentPath,
		"@earendil-works/pi-tui": tuiPath,
	},
});

process.env.PI_CODING_AGENT_DIR ??= resolve(import.meta.dirname, "../../..");
sdk.initTheme("active", false);
const { default: diffExtension } = (await jiti.import(resolve(import.meta.dirname, "index.ts"))) as {
	default: (pi: unknown) => Promise<void>;
};
const { parseDiff } = (await jiti.import(resolve(import.meta.dirname, "core/diff.ts"))) as {
	parseDiff: (oldContent: string, newContent: string) => unknown;
};
const { installHostDecorator } = (await jiti.import(resolve(import.meta.dirname, "../../tool-display/host-decorator.ts"))) as {
	installHostDecorator: () => void;
};

const tools = new Map<string, any>();
await diffExtension({
	on() {},
	registerTool(tool: any) {
		tools.set(tool.name, tool);
	},
});
installHostDecorator();

function createToolComponent(toolName: string, details: Record<string, unknown>): any {
	const component = new sdk.ToolExecutionComponent(
		toolName,
		`render-${toolName}`,
		{ path: `/tmp/pi-diff-render-${toolName}.ts` },
		{ showImages: false },
		tools.get(toolName),
		{ requestRender() {} },
		process.cwd(),
	);
	component.updateResult({ content: [{ type: "text", text: "render fixture" }], details, isError: false });
	return component;
}

async function settleRender(component: any, width: number, contains: string): Promise<string[]> {
	for (let attempt = 0; attempt < 100; attempt++) {
		const rows = component.render(width) as string[];
		if (rows.some((line) => stripTerminalSequences(line).includes(contains))) return rows;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	assert.fail(`render did not settle with ${JSON.stringify(contains)} at width ${width}`);
}

const fixtureDiff = () => parseDiff("x\nc", `${"y".repeat(65)}Z\nc`);

function toolDetails(toolName: string): Record<string, unknown> {
	if (toolName === "edit") return { _type: "editInfo", diff: fixtureDiff(), language: "typescript" };
	if (toolName === "write") return { _type: "diff", diff: fixtureDiff(), language: "typescript" };
	return {
		result: {
			ok: true,
			applied: [{ action: "update", path: "/tmp/pi-diff-render-apply_patch.ts", oldContent: "x\nc", newContent: `${"y".repeat(65)}Z\nc` }],
		},
	};
}

test("decorated mutation cards preserve production diff geometry", async () => {
	for (const toolName of ["edit", "write", "apply_patch"]) {
		const rows = await settleRender(createToolComponent(toolName, toolDetails(toolName)), 142, "Z");
		const continuationIndex = rows.findIndex((line) => stripTerminalSequences(line).includes("Z"));
		assert.notEqual(continuationIndex, -1, toolName);
		const continuation = stripTerminalSequences(rows[continuationIndex] ?? "");
		assert.equal(continuation.indexOf("Z"), 76, toolName);
		assert.match(rows[continuationIndex] ?? "", /\x1b\[48;/, `${toolName} continuation keeps its diff background`);
		assert.match(rows[continuationIndex] ?? "", /\x1b\[38;/, `${toolName} continuation keeps syntax foregrounds`);
		for (const row of rows.filter((line) => line.length > 0)) assert.equal(visibleWidth(row), 142, toolName);
	}
});

test("the latest width wins when an async highlighted preview is resized", async () => {
	const component = createToolComponent("edit", {
		_type: "editInfo",
		diff: parseDiff("x\nc", `${"y".repeat(45)}Z\nc`),
		language: "typescript",
	});
	component.render(142);
	const rows = await settleRender(component, 102, "Z");
	const continuation = rows.map(stripTerminalSequences).find((line) => line.includes("Z"));
	assert.ok(continuation);
	assert.equal(continuation.indexOf("Z"), 56);
	for (const row of rows.filter((line) => line.length > 0)) assert.equal(visibleWidth(row), 102);
});

test("native collapsed and expanded states retain their preview limits", async () => {
	const oldContent = Array.from({ length: 40 }, (_, index) => `old_${index}`).join("\n");
	const newContent = Array.from({ length: 40 }, (_, index) => `new_${index}`).join("\n");
	const component = createToolComponent("edit", {
		_type: "editInfo",
		diff: parseDiff(oldContent, newContent),
		language: undefined,
	});
	const collapsed = await settleRender(component, 142, "more lines");
	assert.ok(collapsed.some((line) => stripTerminalSequences(line).includes("more lines")));
	component.setExpanded(true);
	const expanded = await settleRender(component, 142, "new_39");
	assert.ok(expanded.some((line) => stripTerminalSequences(line).includes("new_39")));
	assert.ok(!expanded.some((line) => stripTerminalSequences(line).includes("more lines")));
});
