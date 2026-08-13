export interface LinkOccurrence {
  displayName: string;
  normalizedName: string;
  from: number;
  to: number;
}

export function normalizeLink(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export function parseLinks(content: string): LinkOccurrence[] {
  const links: LinkOccurrence[] = [];
  let cursor = 0;

  while (cursor < content.length - 1) {
    const from = content.indexOf("[[", cursor);
    if (from === -1) {
      break;
    }

    let slashCount = 0;
    for (let previous = from - 1; previous >= 0 && content[previous] === "\\"; previous -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 1) {
      cursor = from + 2;
      continue;
    }

    const lineEnd = content.indexOf("\n", from + 2);
    const toStart = content.indexOf("]]", from + 2);
    if (toStart === -1 || (lineEnd !== -1 && lineEnd < toStart)) {
      cursor = lineEnd === -1 ? content.length : lineEnd + 1;
      continue;
    }

    const displayName = content.slice(from + 2, toStart).trim();
    if (displayName) {
      links.push({
        displayName,
        from,
        normalizedName: normalizeLink(displayName),
        to: toStart + 2,
      });
    }
    cursor = toStart + 2;
  }

  return links;
}

export function uniqueLinks(content: string): LinkOccurrence[] {
  const seen = new Set<string>();
  return parseLinks(content).filter((link) => {
    if (seen.has(link.normalizedName)) {
      return false;
    }
    seen.add(link.normalizedName);
    return true;
  });
}
