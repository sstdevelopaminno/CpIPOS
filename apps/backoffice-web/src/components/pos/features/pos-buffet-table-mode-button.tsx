"use client";

import { useEffect, useState, type ReactNode } from "react";

type Props = {
  label: string;
  hint: string;
  active: boolean;
  locked: boolean;
  icon?: ReactNode;
  lockTitle?: string;
  onClick: () => void;
};

type ProfileBody = {
  data?: { product_profile?: string | null } | null;
};

type ProfileState = "loading" | "buffet" | "standard";

const POS_SCOPE_KEY = "pos_scope_v001";
const PROFILE_CACHE_PREFIX = "cpipos_product_profile_v1";
const FF0001_TENANT_ID = "997a0329-604f-49eb-a091-e654a57e6b8e";

function BuffetTableModeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7">
      <path d="M12 3.75a1.05 1.05 0 0 1 1.05 1.05v.78a7.02 7.02 0 0 1 6.22 6.97H4.73a7.02 7.02 0 0 1 6.22-6.97V4.8A1.05 1.05 0 0 1 12 3.75Z" fill="currentColor" />
      <path d="M3.75 14.4h16.5v1.15a3.7 3.7 0 0 1-3.7 3.7h-9.1a3.7 3.7 0 0 1-3.7-3.7V14.4Z" fill="currentColor" />
      <path d="M7.1 10.85c.62-1.6 2.43-2.74 4.9-2.74s4.28 1.14 4.9 2.74" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.55" />
      <path d="M6.5 20.5h11" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

function readTenantId() {
  if (typeof window === "undefined") return "";
  try {
    return String(window.localStorage.getItem(POS_SCOPE_KEY) ?? "").split(":", 1)[0]?.trim() ?? "";
  } catch {
    return "";
  }
}

function cacheKey(tenantId: string) {
  return `${PROFILE_CACHE_PREFIX}:${tenantId}`;
}

function readInitialProfileState(): ProfileState {
  if (typeof window === "undefined") return "loading";
  const tenantId = readTenantId();
  if (!tenantId) return "loading";
  try {
    const cached = window.sessionStorage.getItem(cacheKey(tenantId));
    if (cached === "BUFFET") return "buffet";
    if (cached === "STANDARD") return "standard";
  } catch {
    // Cache is optional.
  }
  // FF0001 is the Buffet acceptance tenant. Resolve it synchronously so the
  // selector never paints the generic four-mode grid before profile fetch.
  return tenantId === FF0001_TENANT_ID ? "buffet" : "loading";
}

export function PosBuffetTableModeButton({ label, hint, active, locked, lockTitle, onClick }: Props) {
  const [profileState, setProfileState] = useState<ProfileState>(readInitialProfileState);
  const isBuffetProfile = profileState === "buffet";

  useEffect(() => {
    let cancelled = false;
    const tenantId = readTenantId();
    void fetch("/api/pos/product-profile", {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" }
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as ProfileBody | null;
        if (cancelled || !response.ok) return;
        const next: ProfileState = body?.data?.product_profile === "BUFFET" ? "buffet" : "standard";
        setProfileState(next);
        if (tenantId) {
          try {
            window.sessionStorage.setItem(cacheKey(tenantId), next === "buffet" ? "BUFFET" : "STANDARD");
          } catch {
            // Cache is optional.
          }
        }
      })
      .catch(() => {
        if (!cancelled) setProfileState((current) => (current === "loading" ? "standard" : current));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <style>{`
        .posui-mode-selector__grid:has(.cpipos-buffet-profile-probe[data-profile-state="loading"]) {
          visibility: hidden !important;
          pointer-events: none !important;
        }
        .posui-mode-selector__grid:has(.cpipos-buffet-profile-mode) > button.posui-mode-option:nth-of-type(2),
        .posui-mode-selector__grid:has(.cpipos-buffet-profile-mode) > button.posui-mode-option:nth-of-type(4) {
          display: none !important;
        }
        .posui-mode-selector__grid:has(.cpipos-buffet-profile-mode) {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }
        body:has(.cpipos-buffet-profile-mode) .posui-modal--buffet { width: min(800px, 92vw) !important; }
        body:has(.cpipos-buffet-profile-mode) .posui-modal--buffet .h-14 { height: 3rem !important; }
        body:has(.cpipos-buffet-profile-mode) .posui-modal--buffet .p-6 { padding: 1.25rem !important; }
        body:has(.cpipos-buffet-profile-mode) .posui-modal--buffet .gap-6 { gap: 1.25rem !important; }
        body:has(.cpipos-buffet-profile-mode) .posui-modal--buffet .text-6xl { font-size: 3rem !important; }
        body:has(.cpipos-buffet-profile-mode) .posui-modal--buffet .text-4xl { font-size: 2rem !important; }
        @media (min-width: 1024px) {
          body:has(.cpipos-buffet-profile-mode) .posui-modal--buffet > div.mt-2.grid:not([role="list"]) {
            grid-template-columns: minmax(0, 1fr) 240px !important;
          }
        }
      `}</style>
      <button
        type="button"
        data-profile-state={profileState}
        className={`posui-mode-option cpipos-buffet-profile-probe ${isBuffetProfile ? "cpipos-buffet-profile-mode" : ""} ${active ? "is-active" : ""} ${locked ? "is-locked" : ""}`}
        onClick={onClick}
        aria-disabled={locked}
        title={locked ? lockTitle : undefined}
      >
        <span className="posui-mode-option__icon" aria-hidden="true"><BuffetTableModeIcon /></span>
        <span className="posui-mode-option__copy"><strong>{label}</strong><small>{hint}</small></span>
        <span className="posui-mode-option__check" aria-hidden="true">✓</span>
      </button>
    </>
  );
}
