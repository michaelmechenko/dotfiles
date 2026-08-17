import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

export interface ClipboardImage {
	bytes: Uint8Array;
	mimeType: string;
}

export interface ClipboardReaders {
	readImage: () => Promise<ClipboardImage | null>;
	readText: () => Promise<string | null>;
}

export type RecalibrationClipboardPaste =
	| { kind: "image"; image: ImageContent }
	| { kind: "text"; text: string };

export interface RecalibrationDraft {
	text: string;
	images: ImageContent[];
}

export const RECALIBRATION_IMAGE_MARKER = "[Pasted image]";

export async function readRecalibrationClipboardPaste(readers: ClipboardReaders): Promise<RecalibrationClipboardPaste | undefined> {
	try {
		const image = await readers.readImage();
		if (image) return { kind: "image", image: { type: "image", data: Buffer.from(image.bytes).toString("base64"), mimeType: image.mimeType } };
	} catch {
		// A platform may not expose image clipboard support; still try text.
	}
	try {
		const text = await readers.readText();
		return text ? { kind: "text", text } : undefined;
	} catch {
		return undefined;
	}
}

export function appendRecalibrationClipboardPaste(draft: RecalibrationDraft, paste: RecalibrationClipboardPaste | undefined): RecalibrationDraft {
	if (!paste) return draft;
	if (paste.kind === "text") return { ...draft, text: `${draft.text}${paste.text}` };
	return { text: `${draft.text}${RECALIBRATION_IMAGE_MARKER}`, images: [...draft.images, paste.image] };
}

export function buildRecalibrationMessage(executionContext: string, draft: RecalibrationDraft): (TextContent | ImageContent)[] {
	return [{ type: "text", text: `${executionContext}\n\nUser requested changes:\n${draft.text.trim()}` }, ...draft.images];
}
