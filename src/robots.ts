/** Reads the parts of robots.txt that the checks need. Pure. */

export interface RobotsInfo {
  /** True when the group for all robots disallows the whole site ("Disallow: /"). */
  blocksAll: boolean;
  /** Addresses from "Sitemap:" lines. */
  sitemapUrls: string[];
}

export function parseRobots(text: string): RobotsInfo {
  const sitemapUrls: string[] = [];
  let blocksAll = false;
  let agents: string[] = [];
  let lastWasAgent = false;
  let groupHasAllowAll = false;
  let groupDisallowsAll = false;
  const flush = () => {
    if (agents.includes("*") && groupDisallowsAll && !groupHasAllowAll) blocksAll = true;
  };
  for (const rawLine of text.split(/\r?\n/).slice(0, 5000)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "sitemap") {
      if (value && sitemapUrls.length < 20) sitemapUrls.push(value);
    } else if (field === "user-agent") {
      if (!lastWasAgent) {
        flush();
        agents = [];
        groupDisallowsAll = false;
        groupHasAllowAll = false;
      }
      agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    } else if (field === "disallow" && value === "/") groupDisallowsAll = true;
    else if (field === "allow" && value === "/") groupHasAllowAll = true;
    lastWasAgent = false;
  }
  flush();
  return { blocksAll, sitemapUrls };
}
