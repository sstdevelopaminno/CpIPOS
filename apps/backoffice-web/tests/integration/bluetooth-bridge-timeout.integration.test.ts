import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAuthContext = vi.fn();

vi.mock("@/lib/auth-context", () => ({
  getAuthContext
}));

function installHangingFetch() {
  const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function authedManager() {
  getAuthContext.mockResolvedValue({
    userId: "u1",
    platformRole: "tenant_user",
    tenantId: "t1",
    branchId: "b1",
    branchRole: "manager"
  });
}

describe("Bluetooth bridge API timeouts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    authedManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns a health envelope when the bridge request times out", async () => {
    const fetchMock = installHangingFetch();
    const { POST } = await import("@/app/api/backoffice/printers/bluetooth/health/route");

    const responsePromise = POST(
      new Request("http://localhost/api/backoffice/printers/bluetooth/health", {
        method: "POST",
        body: JSON.stringify({ bridge_url: "http://127.0.0.1:3210/print", timeout_ms: 1 })
      })
    );
    await vi.advanceTimersByTimeAsync(1000);

    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body.data.code).toBe("bridge_unreachable");
    expect(body.data.message).toBe("bridge_request_timeout:1000ms");
  });

  it("returns a failed discovery response when the bridge request times out", async () => {
    installHangingFetch();
    const { POST } = await import("@/app/api/backoffice/printers/bluetooth/discover/route");

    const responsePromise = POST(
      new Request("http://localhost/api/backoffice/printers/bluetooth/discover", {
        method: "POST",
        body: JSON.stringify({ bridge_url: "http://127.0.0.1:3210/print", timeout_ms: 1 })
      })
    );
    await vi.advanceTimersByTimeAsync(1000);

    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.error.code).toBe("bluetooth_discover_timeout");
    expect(body.error.message).toBe("Bluetooth bridge did not respond in time.");
  });

  it("returns a failed connect response when the bridge request times out", async () => {
    installHangingFetch();
    const { POST } = await import("@/app/api/backoffice/printers/bluetooth/connect/route");

    const responsePromise = POST(
      new Request("http://localhost/api/backoffice/printers/bluetooth/connect", {
        method: "POST",
        body: JSON.stringify({
          bridge_url: "http://127.0.0.1:3210/print",
          bluetooth_address: "AA:BB:CC:DD:EE:FF",
          timeout_ms: 1
        })
      })
    );
    await vi.advanceTimersByTimeAsync(1000);

    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.error.code).toBe("bluetooth_connect_timeout");
    expect(body.error.message).toBe("Bluetooth bridge did not respond in time.");
  });
});
