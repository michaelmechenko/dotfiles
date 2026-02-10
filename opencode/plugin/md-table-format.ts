import type { Plugin, Hooks } from "@opencode-ai/plugin";

/**
 * Converts markdown tables in assistant output to bullet lists.
 * Tables render poorly in terminal environments; bullets are always legible.
 *
 * Conversion rules:
 * - 2-column: `- **col1** -- col2`
 * - 3-column: `- **col1** -- Header2: val, Header3: val`
 * - 4+ column: `- **col1**` with nested `  - Header: value` bullets
 * - 1-column: `- value`
 * - Tables inside code fences are left untouched.
 */
export const TablesToBullets: Plugin = async () => {
  return {
    "experimental.text.complete": async (
      input: { sessionID: string; messageID: string; partID: string },
      output: { text: string },
    ) => {
      try {
        output.text = convertTables(output.text);
      } catch (error) {
        output.text =
          output.text +
          "\n\n<!-- table conversion failed: " +
          (error as Error).message +
          " -->";
      }
    },
  } as Hooks;
};

function convertTables(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;
  let inCodeFence = false;

  while (i < lines.length) {
    const line = lines[i];

    // Track code fences -- skip table detection inside them
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
      result.push(line);
      i++;
      continue;
    }

    if (!inCodeFence && isTableRow(line)) {
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && isTableRow(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }

      if (isValidTable(tableLines)) {
        result.push(...tableToBullets(tableLines));
      } else {
        result.push(...tableLines);
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join("\n");
}

// --- Table detection ---

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("|") &&
    trimmed.endsWith("|") &&
    trimmed.split("|").length > 2
  );
}

function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  const cells = trimmed.split("|").slice(1, -1);
  return cells.length > 0 && cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell));
}

function isValidTable(lines: string[]): boolean {
  if (lines.length < 2) return false;
  const rows = lines.map(parseCells);
  if (rows.length === 0 || rows[0].length === 0) return false;
  const colCount = rows[0].length;
  if (!rows.every((row) => row.length === colCount)) return false;
  return lines.some(isSeparatorRow);
}

function parseCells(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

// --- Conversion ---

function tableToBullets(lines: string[]): string[] {
  const allRows = lines.map(parseCells);
  const separatorIndices = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (isSeparatorRow(lines[i])) separatorIndices.add(i);
  }

  // Header is the row immediately before the first separator
  const firstSepIdx = [...separatorIndices][0] ?? 1;
  const headers =
    firstSepIdx > 0 && !separatorIndices.has(firstSepIdx - 1)
      ? allRows[firstSepIdx - 1]
      : [];
  const dataRows = allRows.filter(
    (_, i) => !separatorIndices.has(i) && i !== firstSepIdx - 1,
  );

  if (dataRows.length === 0) return [];

  const colCount = headers.length || dataRows[0].length;
  const result: string[] = [];

  for (const row of dataRows) {
    if (colCount === 1) {
      result.push(`- ${row[0]}`);
    } else if (colCount === 2) {
      result.push(`- **${row[0]}** -- ${row[1]}`);
    } else if (colCount === 3) {
      const parts = headers
        .slice(1)
        .map((h, i) => `${h}: ${row[i + 1]}`)
        .join(", ");
      result.push(`- **${row[0]}** -- ${parts}`);
    } else {
      // 4+ columns: nested bullets
      result.push(`- **${row[0]}**`);
      for (let c = 1; c < row.length; c++) {
        const label = headers[c] || `Col ${c + 1}`;
        result.push(`  - ${label}: ${row[c]}`);
      }
    }
  }

  return result;
}
