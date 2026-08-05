"use client";

import type { ReactNode } from "react";

type Props = {
  label: string;
  hint: string;
  active: boolean;
  locked: boolean;
  icon?: ReactNode;
  lockTitle?: string;
  onClick: () => void;
};

export function PosBuffetTableModeButton({ label, hint, active, locked, icon, lockTitle, onClick }: Props) {
  return (
    <button
      type="button"
      className={`posui-mode-option ${active ? "is-active" : ""} ${locked ? "is-locked" : ""}`}
      onClick={onClick}
      aria-disabled={locked}
      title={locked ? lockTitle : undefined}
    >
      <span className="posui-mode-option__icon" aria-hidden="true">
        {icon ?? "🍽️"}
      </span>
      <span className="posui-mode-option__copy">
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <span className="posui-mode-option__check" aria-hidden="true">
        ✓
      </span>
    </button>
  );
}
