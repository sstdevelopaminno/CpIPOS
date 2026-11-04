/**
 * Strict runtime isolation for print queues.
 *
 * A printer explicitly configured for the Windows native spooler can only
 * be leased to a Windows agent. Android agents with the same POS device code
 * must not claim its jobs. Windows agents can never claim legacy Android jobs.
 * No implicit Windows detection from a misleading display name.
 */
export function agentRuntimeMatchesPrinter(printerRuntime: unknown, agentRuntime: unknown): boolean {
  const windowsPrinter = printerRuntime === "windows_native";
  const windowsAgent = agentRuntime === "windows_native_print_agent_v1";
  return windowsPrinter === windowsAgent;
}
