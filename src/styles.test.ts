import { describe, expect, it } from "vitest";

import styles from "./styles.css?inline";

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return "selectorText" in rule && "style" in rule;
}

function withStyles(test: (propertyFor: (selector: string, property: string) => string | undefined) => void) {
  const stylesheet = document.createElement("style");
  stylesheet.textContent = styles;
  document.head.append(stylesheet);
  const rules = stylesheet.sheet ? [...stylesheet.sheet.cssRules].filter((rule) => isStyleRule(rule)) : [];
  const propertyFor = (selector: string, property: string) =>
    rules.find((rule) => rule.selectorText === selector)?.style.getPropertyValue(property);

  try {
    test(propertyFor);
  } finally {
    stylesheet.remove();
  }
}

describe("application layout", () => {
  it("本文とサイドバーのスクロール領域を画面内に制約する", () => {
    withStyles((propertyFor) => {
      expect(propertyFor(".app-shell", "grid-template-columns")).toBe("272px minmax(430px, 1fr)");
      expect(propertyFor(".app-shell", "grid-template-rows")).toBe("minmax(0, 1fr)");
      expect(propertyFor(".document-body", "overflow-y")).toBe("auto");
    });
  });

  it("タイトルと本文を同じスクロール領域に置く", () => {
    withStyles((propertyFor) => {
      expect(propertyFor(".document-body .memo-editor", "flex-shrink")).toBe("0");
      expect(propertyFor(".document-body .memo-editor", "overflow")).toBe("visible");
      expect(propertyFor(".document-body .cm-editor", "height")).toBe("auto");
      expect(propertyFor(".document-body .cm-scroller", "overflow")).toBe("visible");
    });
  });
});
