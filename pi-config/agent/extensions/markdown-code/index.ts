import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { transformFencedMarkdown } from "./fences.ts";

export default function markdownCodeExtension(pi: ExtensionAPI): void {
	pi.registerMarkdownTransformer((markdown) => transformFencedMarkdown(markdown));
}
