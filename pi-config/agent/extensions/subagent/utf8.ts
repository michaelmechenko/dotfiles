const decoder = new TextDecoder("utf-8", { fatal: true });

/** Clip by UTF-8 bytes without splitting code points or retaining lone surrogates. */
export function truncateUtf8(text: string, cap: number): string {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length <= cap) return bytes.toString("utf8");
	for (let end = Math.max(0, Math.floor(cap)); end >= Math.max(0, cap - 3); end--) {
		try { return decoder.decode(bytes.subarray(0, end)); } catch { /* incomplete final code point */ }
	}
	return "";
}
