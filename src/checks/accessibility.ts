import { findAll, type ParsedHtml } from "../html";
import type { AuditInput, CheckOutcome } from "../types";
import { Collector } from "./helpers";

const SKIPPED_INPUT_TYPES = new Set(["hidden", "submit", "button", "image", "reset"]);

export function checkAccessibility(_input: AuditInput, doc: ParsedHtml): CheckOutcome {
  const c = new Collector("accessibility");

  // Language of the document (also helps search engines and translation)
  const html = findAll(doc, "html")[0];
  const lang = (html?.attrs["lang"] ?? "").trim();
  c.check(/^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(lang), "The html element has a lang attribute", {
    id: "lang",
    severity: "medium",
    title: lang ? "The lang attribute looks invalid" : "Missing lang attribute on <html>",
    why: "Screen readers use the language to pick the right pronunciation, and browsers and search engines use it for translation and targeting.",
    fix: "Set it on the root element, for example <html lang=\"en\"> or <html lang=\"pl\">.",
    detail: lang ? `lang="${lang}"` : undefined,
  });

  // Images need an alt attribute (alt="" is valid for decorative images)
  const imgs = findAll(doc, "img");
  const noAlt = imgs.filter((t) => !("alt" in t.attrs));
  c.check(noAlt.length === 0, "All images have an alt attribute", {
    id: "img-alt",
    severity: "high",
    title: "Images without an alt attribute",
    why: "Screen reader users get no description of these images, and search engines cannot understand them.",
    fix: "Add a short alt text describing the image, or alt=\"\" if the image is purely decorative.",
    detail: `${noAlt.length} of ${imgs.length} images`,
  });

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
    c.check(unlabeled.length === 0, "Form fields have labels", {
      id: "form-labels",
      severity: "high",
      title: "Form fields without a label",
      why: "People using screen readers will not know what to type, and tapping the label cannot focus the field. A placeholder is not a replacement for a label.",
      fix: "Add a <label for=\"...\"> for each field, or wrap the field in a <label>.",
      detail: `${unlabeled.length} of ${fields.length} fields`,
    });
  }

  // Heading order
  const levels = doc.headings.map((h) => h.level);
  const skips: string[] = [];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i]! > levels[i - 1]! + 1) skips.push(`h${levels[i - 1]} to h${levels[i]}`);
  }
  if (levels.length > 0) {
    c.check(skips.length === 0, "Headings follow a sensible order", {
      id: "heading-order",
      severity: "low",
      title: "Heading levels are skipped",
      why: "Screen reader users navigate by headings. Jumping from h2 to h4 breaks the outline of the page.",
      fix: "Use heading levels in order and choose them for structure, not for size (style the size with CSS).",
      detail: skips.slice(0, 3).join(", "),
    });
  }

  return c.result();
}
