import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const program = readFileSync(resolve(root, "apps/windows-runtime-native/Cpipos.WindowsRuntime/Program.cs"), "utf8");
const bridge = readFileSync(resolve(root, "apps/windows-runtime-native/Cpipos.WindowsRuntime/LocalPrintBridge.cs"), "utf8");

describe("Windows native embedded print runtime contract", () => {
  it("keeps the Local Print Bridge inside the native POS process lifetime", () => {
    expect(program).toContain("using var bridge = new LocalPrintBridge");
    expect(program).toContain("bridge.Start();");
    expect(program).toContain("Application.Run(options.UseLegacyWebPos ? new MainForm(options, bridge) : new NativePosForm(options, bridge));");
  });

  it("binds the print bridge to localhost only and keeps accepting after transient listener errors", () => {
    expect(bridge).toContain('new TcpListener(IPAddress.Parse("127.0.0.1"), _port)');
    expect(bridge).toContain("while (!cancellationToken.IsCancellationRequested)");
    expect(bridge).toContain("await Task.Delay(250, cancellationToken)");
  });

  it("bounds concurrent local requests so printer stalls cannot exhaust the runtime", () => {
    expect(bridge).toContain("_requestSlots = new(16, 16)");
    expect(bridge).toContain("WaitAsync(TimeSpan.FromSeconds(5)");
    expect(bridge).toContain('"bridge_busy"');
    expect(bridge).toContain("timeout.CancelAfter(TimeSpan.FromSeconds(30))");
  });
});
