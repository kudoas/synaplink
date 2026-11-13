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
  let lineOffset = 0;

  for (const line of content.split("\n")) {
    let cursor = 0;
    while (cursor < line.length - 1) {
      const from = line.indexOf("[[", cursor);
      if (from === -1) {
        break;
      }

      let slashCount = 0;
      for (let previous = from - 1; previous >= 0 && line[previous] === "\\"; previous -= 1) {
        slashCount += 1;
      }
      if (slashCount % 2 === 1) {
        cursor = from + 2;
        continue;
      }

      const toStart = line.indexOf("]]", from + 2);
      if (toStart === -1) {
        break;
      }

      const displayName = line.slice(from + 2, toStart).trim();
      if (displayName) {
        links.push({
          displayName,
          from: lineOffset + from,
          normalizedName: normalizeLink(displayName),
          to: lineOffset + toStart + 2,
        });
      }
      cursor = toStart + 2;
    }
    lineOffset += line.length + 1;
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
