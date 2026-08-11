export interface UrlOccurrence {
  from: number;
  to: number;
  url: string;
}

const bracketPairs = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["（", "）"],
  ["［", "］"],
  ["｛", "｝"],
] as const;
const trailingPunctuation = /[.,!?;:、。！？；：〉》」』】〕〗〙〛]+$/u;
const urlCandidate = /https:\/\/[^\s<>"']+/giu;

function trimTrailingCharacters(value: string): string {
  let trimmed = value;

  while (trimmed) {
    const withoutPunctuation = trimmed.replace(trailingPunctuation, "");
    if (withoutPunctuation !== trimmed) {
      trimmed = withoutPunctuation;
      continue;
    }

    let unmatchedClosing: string | null = null;
    for (const [opening, closing] of bracketPairs) {
      if (trimmed.endsWith(closing) && trimmed.split(closing).length > trimmed.split(opening).length) {
        unmatchedClosing = closing;
        break;
      }
    }
    if (!unmatchedClosing) {
      break;
    }
    trimmed = trimmed.slice(0, -unmatchedClosing.length);
  }

  return trimmed;
}

export function parseUrls(content: string): UrlOccurrence[] {
  const urls: UrlOccurrence[] = [];

  for (const match of content.matchAll(urlCandidate)) {
    const from = match.index;
    if (/[\p{L}\p{N}_:/]$/u.test(content.slice(0, from))) {
      continue;
    }

    const candidate = trimTrailingCharacters(match[0]);
    if (!candidate) {
      continue;
    }

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== "https:" || !parsed.hostname) {
        continue;
      }
    } catch {
      continue;
    }

    const url = candidate.replace(/^https/iu, (scheme) => scheme.toLowerCase());
    urls.push({ from, to: from + candidate.length, url });
  }

  return urls;
}
