export interface TagOccurrence {
  displayName: string;
  normalizedName: string;
  from: number;
  to: number;
}

const isTagCharacter = (character: string) => /[\p{L}\p{N}_-]/u.test(character);

export function normalizeTag(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export function parseTags(content: string): TagOccurrence[] {
  const tags: TagOccurrence[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    if (content[cursor] !== "#") {
      cursor += content.codePointAt(cursor)! > 0xFFFF ? 2 : 1;
      continue;
    }

    let slashCount = 0;
    for (let previous = cursor - 1; previous >= 0 && content[previous] === "\\"; previous -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 1) {
      cursor += 1;
      continue;
    }

    let end = cursor + 1;
    while (end < content.length) {
      const point = content.codePointAt(end)!;
      const character = String.fromCodePoint(point);
      if (!isTagCharacter(character)) {
        break;
      }
      end += point > 0xFFFF ? 2 : 1;
    }

    if (end > cursor + 1) {
      const displayName = content.slice(cursor + 1, end);
      tags.push({
        displayName,
        from: cursor,
        normalizedName: normalizeTag(displayName),
        to: end,
      });
      cursor = end;
    } else {
      cursor += 1;
    }
  }

  return tags;
}

export function uniqueTags(content: string): TagOccurrence[] {
  const seen = new Set<string>();
  return parseTags(content).filter((tag) => {
    if (seen.has(tag.normalizedName)) {
      return false;
    }
    seen.add(tag.normalizedName);
    return true;
  });
}
