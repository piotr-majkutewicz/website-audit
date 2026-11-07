import { findAll, metaContent, type ParsedHtml } from "../html";
import type { AuditInput, CheckOutcome } from "../types";
import { Collector } from "./helpers";

const SKIPPED_INPUT_TYPES = new Set(["hidden", "submit", "button", "image", "reset"]);

export function checkAccessibility(_input: AuditInput, doc: ParsedHtml): CheckOutcome {
  const c = new Collector("accessibility");

  // Language of the document (also helps search engines and translation)
  const html = findAll(doc, "html")[0];
  const lang = (html?.attrs["lang"] ?? "").trim();
  c.check(/^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(lang), {
    id: "lang",
    key: lang ? "lang.invalid" : "lang.missing",
    severity: "medium",
    params: { value: lang.slice(0, 40) },
  });

  // Images need an alt attribute (alt="" is valid for decorative images)
  const imgs = findAll(doc, "img");
  const noAlt = imgs.filter((t) => !("alt" in t.attrs));
  c.check(noAlt.length === 0, { id: "img-alt", severity: "high", params: { count: noAlt.length, total: imgs.length } });

  // Form fields need labels
  const labelFor = new Set(findAll(doc, "label").map((t) => t.attrs["for"]).filter((v): v is string => Boolean(v)));
  const fields = doc.tags.filter(
    (t) =>
      (t.name === "input" && !SKIPPED_INPUT_TYPES.has((t.attrs["type"] ?? "text").toLowerCase())) ||
      t.name === "select" ||
      t.name === "textarea",
  );
  const unlabeled = fields.filter((t) => {
    if (t.labelDepth > 0) return false;
    if (t.attrs["aria-label"]?.trim() || t.attrs["aria-labelledby"]?.trim() || t.attrs["title"]?.trim()) return false;
    return !(t.attrs["id"] && labelFor.has(t.attrs["id"]));
  });
  if (fields.length > 0) {
    c.check(unlabeled.length === 0, { id: "form-labels", severity: "high", params: { count: unlabeled.length, total: fields.length } });
  }

  // Heading order
  const levels = doc.headings.map((h) => h.level);
  const skips: string[] = [];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i]! > levels[i - 1]! + 1) skips.push(`h${levels[i - 1]} → h${levels[i]}`);
  }
  if (levels.length > 0) {
    c.check(skips.length === 0, { id: "heading-order", severity: "low", params: { skips: skips.slice(0, 3).join(", ") } });
  }

  // A viewport that blocks pinch zoom shuts out people who need larger text.
  const viewport = metaContent(doc, "name", "viewport");
  if (viewport) {
    const v = viewport.toLowerCase().replace(/\s+/g, "");
    const max = /maximum-scale=([\d.]+)/.exec(v);
    const blocked = /user-scalable=(no|0)/.test(v) || (max !== null && Number(max[1]) <= 1);
    c.check(!blocked, { id: "zoom", key: "viewport-zoom", severity: "medium" });
  }

  return c.result();
}
