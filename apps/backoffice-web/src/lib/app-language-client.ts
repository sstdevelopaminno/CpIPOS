"use client";

import { useEffect, useMemo, useState } from "react";

export type AppLanguage = "th" | "en" | "lo";

const LANGUAGE_COOKIE_KEY = "sstipos_lang";
const LANGUAGE_STORAGE_KEY = "sstipos_lang";

export function normalizeLanguage(value?: string | null): AppLanguage {
  return value === "en" || value === "lo" ? value : "th";
}

function getBrowserLanguage(): AppLanguage {
  if (typeof navigator === "undefined") return "th";
  return navigator.language?.toLowerCase().startsWith("lo") ? "lo" : navigator.language?.toLowerCase().startsWith("en") ? "en" : "th";
}

function readLanguageFromClientStorage(): AppLanguage | null {
  if (typeof window === "undefined") return null;
  // POS and pre-entry previously wrote different keys. The POS language is
  // authoritative when leaving the sales screen and returning to login.
  const posStorage = window.localStorage.getItem("pos_lang");
  if (posStorage === "th" || posStorage === "en" || posStorage === "lo") return posStorage;
  const fromStorage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (fromStorage === "th" || fromStorage === "en" || fromStorage === "lo") return fromStorage;
  const fromCookie = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${LANGUAGE_COOKIE_KEY}=`))
    ?.split("=")[1];
  if (fromCookie === "th" || fromCookie === "en" || fromCookie === "lo") return fromCookie;
  return null;
}

function persistLanguageOnClient(lang: AppLanguage) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  window.localStorage.setItem("pos_lang", lang);
  document.cookie = `${LANGUAGE_COOKIE_KEY}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.cookie = `pos_lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function useAppLanguage(defaultLanguage: AppLanguage = "th") {
  // Keep first render deterministic to avoid hydration mismatch.
  const [lang, setLang] = useState<AppLanguage>(defaultLanguage);

  useEffect(() => {
    const preferred = readLanguageFromClientStorage() ?? getBrowserLanguage();
    setLang(preferred);
    persistLanguageOnClient(preferred);
  }, []);

  const api = useMemo(
    () => ({
      lang,
      setLanguage(nextLang: AppLanguage) {
        setLang(nextLang);
        persistLanguageOnClient(nextLang);
      }
    }),
    [lang]
  );

  return api;
}
