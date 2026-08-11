import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TagResults } from "./TagResults";

describe("TagResults", () => {
  it("関連メモを表示して選択できる", () => {
    const onSelect = vi.fn();
    render(
      <TagResults
        tag="りんご"
        notes={[{ id: "1.txt", title: "赤い果物", preview: "甘い", modifiedAt: 1, revision: "r", tags: [] }]}
        onBack={() => undefined}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText("#りんご")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /赤い果物/ }));
    expect(onSelect).toHaveBeenCalledWith("1.txt");
  });
});
