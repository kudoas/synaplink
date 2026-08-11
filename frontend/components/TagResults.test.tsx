import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TagResults } from "./TagResults";

describe(TagResults, () => {
  it("関連メモを表示して選択できる", () => {
    const onBack = vi.fn<() => void>();
    const onSelect = vi.fn();
    render(
      <TagResults
        tag="りんご"
        notes={[{ id: "1.txt", modifiedAt: 1, preview: "甘い", revision: "r", tags: [], title: "赤い果物" }]}
        onBack={onBack}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText("#りんご")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /赤い果物/u }));
    expect(onSelect).toHaveBeenCalledWith("1.txt");
  });
});
