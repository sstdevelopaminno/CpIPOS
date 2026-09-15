export type NativeDisplayDiagnostics = {
  install_id?: unknown;
  display_count?: unknown;
  secondary_display_available?: unknown;
  displays?: {
    display_count?: unknown;
    secondary_display_available?: unknown;
  };
  runtime_capabilities?: {
    display?: {
      secondary_display_available?: unknown;
    };
  };
};

function bool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  return null;
}

export function shouldDisableNativeCustomerDisplayForDiagnostics(diagnostics: NativeDisplayDiagnostics | null | undefined): boolean {
  const secondaryAvailable = bool(diagnostics?.runtime_capabilities?.display?.secondary_display_available)
    ?? bool(diagnostics?.displays?.secondary_display_available)
    ?? bool(diagnostics?.secondary_display_available);
  if (secondaryAvailable === false) return true;
  if (secondaryAvailable === true) return false;

  const displayCount = Number(diagnostics?.displays?.display_count ?? diagnostics?.display_count ?? 0);
  return Number.isFinite(displayCount) && displayCount > 0 && displayCount <= 1;
}
