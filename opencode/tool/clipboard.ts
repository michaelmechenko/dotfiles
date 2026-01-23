import { tool } from "@opencode-ai/plugin";

declare const Bun: any;

export default tool({
  description: "Copy code to clipboard. Use when user wants code copied.",
  args: {
    code: tool.schema
      .string()
      .describe("Only the raw code, no markdown fences or explanation"),
  },
  async execute(args) {
    const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
    proc.stdin.write(args.code);
    proc.stdin.end();
    await proc.exited;
    return "Code copied to clipboard";
  },
});
