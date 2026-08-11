import "@testing-library/jest-dom/vitest";

Range.prototype.getClientRects = () => document.createElement("div").getClientRects();
