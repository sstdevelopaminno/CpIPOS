"use client";

import { useEffect } from "react";

const BROWSER_PRINT_AGENT_CONFIG_EVENT = "cpi-browser-print-agent-config";
const BROWSER_PRINT_AGENT_RESET_EVENT = "cpi-browser-print-agent-reset";
const BROWSER_PRINT_AGENT_ALERT_SNOOZE_UNTIL_KEY = "cpi_browser_print_agent_alert_snooze_until_v1";
const BROWSER_PRINT_AGENT_DEPLOY_VERSION_KEY = "cpi_browser_print_agent_deploy_version_v1";
const BUILD_INFO_URL = "/api/system/build-info";
const FALLBACK_CLIENT_VERSION = "browser-print-agent-deploy-reset-2026-08-02";

type BuildInfoResponse = {
  data?: {
    build_version?: string | null;
    commit_sha?: string | null;
    deployment_id?: string | null;
  } | null;
};

function dispatchAgentReset() {
  window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_RESET_EVENT));
}

function dispatchAgentConfigReload() {
  window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_CONFIG_EVENT));
}

function clearTransientPrintAgentState() {
  window.localStorage.removeItem(BROWSER_PRINT_AGENT_ALERT_SNOOZE_UNTIL_KEY);
}

function applyDeployReset(version: string) {
  const currentVersion = window.localStorage.getItem(BROWSER_PRINT_AGENT_DEPLOY_VERSION_KEY);
  if (currentVersion === version) return;

  window.localStorage.setItem(BROWSER_PRINT_AGENT_DEPLOY_VERSION_KEY, version);
  clearTransientPrintAgentState();
  dispatchAgentReset();
  window.setTimeout(dispatchAgentConfigReload, 250);
  window.setTimeout(dispatchAgentConfigReload, 1500);
  window.setTimeout(dispatchAgentConfigReload, 5000);
}

async function loadBuildVersion() {
  try {
    const response = await fetch(BUILD_INFO_URL, { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as BuildInfoResponse | null;
    return body?.data?.build_version || body?.data?.commit_sha || body?.data?.deployment_id || FALLBACK_CLIENT_VERSION;
  } catch {
    return FALLBACK_CLIENT_VERSION;
  }
}

export function BrowserPrintAgentDeployReset() {
  useEffect(() => {
    let active = true;

    void loadBuildVersion().then((version) => {
      if (!active) return;
      applyDeployReset(version);
    });

    return () => {
      active = false;
    };
  }, []);

  return null;
}
