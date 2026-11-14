import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { describe, expect, it, vi } from "vitest";
import { shutdownApi } from "./shutdown-api";

vi.mock(import("@tauri-apps/api/core"), () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock(import("@tauri-apps/api/event"), () => ({ listen: vi.fn() }));

describe("shutdown api", () => {
  it("終了要求の登録・取消・完了をnativeへ渡す", async () => {
    vi.mocked(invoke).mockReset().mockResolvedValue(null);

    await shutdownApi.register();
    await shutdownApi.cancel("cancelled");
    await shutdownApi.complete("completed");

    expect(vi.mocked(invoke).mock.calls).toStrictEqual([
      ["register_shutdown_guard"],
      ["cancel_shutdown", { requestId: "cancelled" }],
      ["complete_shutdown", { requestId: "completed" }],
    ]);
    expect(shutdownApi.isNative).toBe(isTauri);
  });

  it("nativeイベントのpayloadをlistenerへ渡し解除関数を返す", async () => {
    const unlisten = vi.fn();
    const handler = vi.fn();
    vi.mocked(listen).mockReset().mockResolvedValue(unlisten);

    const stop = await shutdownApi.listen(handler);
    const [[event, listener]] = vi.mocked(listen).mock.calls;
    listener({ event: "synaplink://shutdown-requested", id: 1, payload: { id: "request" } });

    expect(event).toBe("synaplink://shutdown-requested");
    expect(handler).toHaveBeenCalledExactlyOnceWith({ id: "request" });
    expect(stop).toBe(unlisten);
  });
});
