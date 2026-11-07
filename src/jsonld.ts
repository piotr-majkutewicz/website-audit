/** JSON-LD (structured data) inspection. Pure: works on the text of the script blocks. */

export interface JsonLdInfo {
  /** Number of blocks found. */
  total: number;
  /** Blocks that are not valid JSON. */
  invalid: number;
  /** Schema.org types found in the valid blocks, in order of appearance, without duplicates. */
  types: string[];
}

const MAX_TYPES = 12;
const MAX_NODES = 2000;

function collectTypes(node: unknown, out: Set<string>, budget: { nodes: number }, depth: number): void {
  if (budget.nodes-- <= 0 || depth > 6 || out.size >= MAX_TYPES) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, out, budget, depth + 1);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  for (const t of Array.isArray(type) ? type : [type]) {
    if (typeof t === "string" && t.trim()) {
      // "https://schema.org/Product" and "Product" are the same type.
      const short = t.trim().split(/[/#]/).pop()!.slice(0, 60);
      if (short && out.size < MAX_TYPES) out.add(short);
    }
  }
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === "object") collectTypes(value, out, budget, depth + 1);
  }
}

export function inspectJsonLd(blocks: string[]): JsonLdInfo {
  const types = new Set<string>();
  const budget = { nodes: MAX_NODES };
  let invalid = 0;
  for (const block of blocks) {
    try {
      collectTypes(JSON.parse(block), types, budget, 0);
    } catch {
      invalid++;
    }
  }
  return { total: blocks.length, invalid, types: [...types] };
}
