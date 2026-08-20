"use client";

/**
 * Legacy mandatory-update overlay intentionally disabled.
 *
 * Existing CpIPOS Android POS installations (including 1.0.12/1.0.13/1.0.15 and
 * protected customer stores) must continue operating without a forced update screen.
 * Modern Android runtimes opt in through the native capability contract and use the
 * non-forced ManagedUpdateNotice flow instead (Update now / Later).
 *
 * Keep this component mounted as a compatibility no-op so old layouts/imports do not
 * need a broad refactor during the Modern Runtime rollout.
 */
export function AndroidPosMandatoryUpdate() {
  return null;
}
