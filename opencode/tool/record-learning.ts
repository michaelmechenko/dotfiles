import { tool } from "@opencode-ai/plugin";
import * as path from "path";

declare const Bun: any;

const GLOBAL_LEARNINGS = path.join(
  process.env.HOME || "~",
  ".config",
  "opencode",
  "learnings.md",
);

const ALLOWED_TAGS = [
  "pattern",
  "preference",
  "convention",
  "gotcha",
  "correction",
  "tooling",
  "api",
  "performance",
];

const HEADER = `# Learnings

Captured corrections, insights, and conventions from development sessions.

## Standard Tags

| Tag            | Meaning                                          |
| -------------- | ------------------------------------------------ |
| \`#pattern\`     | Architectural or code patterns to follow/avoid   |
| \`#preference\`  | Stylistic or workflow preferences                |
| \`#convention\`  | Naming, structure, or process conventions        |
| \`#gotcha\`      | Non-obvious pitfalls, edge cases, footguns       |
| \`#correction\`  | Direct correction of a wrong approach            |
| \`#tooling\`     | Build tools, CLI, dev environment specifics      |
| \`#api\`         | API behavior, library quirks, external services  |
| \`#performance\` | Performance-related insights                     |

---

`;

async function appendLearning(filePath: string, entry: string) {
  const file = Bun.file(filePath);
  const exists = await file.exists();
  const existing = exists ? await file.text() : HEADER;
  await Bun.write(filePath, existing + entry);
}

function formatEntry(
  learning: string,
  tags: string[],
  timestamp: string,
): string {
  const tagStr = tags.map((t) => `\`#${t.replace(/^#/, "")}\``).join(" ");
  return `- **${timestamp}** ${tagStr} -- ${learning}\n`;
}

export default tool({
  description: `Record a learning, correction, or insight to learnings.md.
Call when the user corrects your approach, clarifies a preference, or reveals a non-obvious convention.

Standard tags: #pattern, #preference, #convention, #gotcha, #correction, #tooling, #api, #performance
Scope: "global" = cross-project insights/preferences, "project" = project-specific, "both" = write to both.`,
  args: {
    learning: tool.schema
      .string()
      .describe(
        "Clear, actionable description of the insight. Write as future guidance (e.g., 'Prefer X over Y when doing Z')",
      ),
    tags: tool.schema
      .array(tool.schema.string())
      .describe(
        "One or more tags: pattern, preference, convention, gotcha, correction, tooling, api, performance",
      ),
    scope: tool.schema
      .enum(["global", "project", "both"])
      .describe(
        "global = ~/.config/opencode/learnings.md, project = {worktree}/learnings.md, both = write to both",
      ),
  },
  async execute(args, context) {
    const now = new Date();
    const timestamp = `${now.toISOString().split("T")[0]} ${now.toTimeString().slice(0, 5)}`;
    const entry = formatEntry(args.learning, args.tags, timestamp);

    // Validate tags
    const invalidTags = args.tags.filter((t) => !ALLOWED_TAGS.includes(t));
    if (invalidTags.length > 0) {
      return `Invalid tags: ${invalidTags.join(", ")}. Allowed: ${ALLOWED_TAGS.join(", ")}`;
    }

    // Auto-add #correction when learning indicates correction language
    const correctionIndicators = [
      "wrong",
      "correct",
      "not right",
      "actually",
      "instead",
      "should have",
    ];
    const indicatesCorrection = correctionIndicators.some((indicator) =>
      args.learning.toLowerCase().includes(indicator),
    );
    if (indicatesCorrection && !args.tags.includes("correction")) {
      args.tags.push("correction");
    }

    const targets: string[] = [];

    if (args.scope === "global" || args.scope === "both") {
      await appendLearning(GLOBAL_LEARNINGS, entry);
      targets.push(GLOBAL_LEARNINGS);
    }

    if (args.scope === "project" || args.scope === "both") {
      const projectPath = path.join(context.worktree, "learnings.md");
      await appendLearning(projectPath, entry);
      targets.push(projectPath);
    }

    return `Recorded to: ${targets.join(", ")}`;
  },
});
