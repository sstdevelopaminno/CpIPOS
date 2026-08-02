"use client";

import { useEffect } from "react";

const BROWSER_PRINT_AGENT_CONFIG_EVENT = "cpi-browser-print-agent-config";
const BROWSER_PRINT_AGENT_RESET_EVENT = "cpi-browser-print-agent-reset";
const BROWSER_PRINT_AGENT_ALERT_SNOOZE_UNTIL_KEY = "cpi_browser_print_agent_alert_snooze_until_v1";
const BROWSER_PRINT_AGENT_DEPLOY_VERSION_KEY = "cpi_browser_print_agent_deploy_version_v1";

// Update this value on every printing-agent deploy that needs local agent state reset.
// It intentionally lives in client code so a new Vercel build can clear stale Web Serial state.
const PRINT_AGENT_DEPLOY_VERSION = "2026-08-02-b601421a-stable-reconnect";

function dispatchAgentReset() {
  window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_RESET_EVENT));
}

function dispatchAgentConfigReload() {
  window.dispatchEvent(new CustomEvent(BROWSER_PRINT_AGENT_CONFIG_EVENT));
}

function clearTransientPrintAgentState() {
  window.localStorage.removeItem(BROWSER_PRINT_AGENT_ALERT_SNOOZE_UNTIL_KEY);
}

export function BrowserPrintAgentDeployReset() {
  useEffect(() => {
    const currentVersion = window.localStorage.getItem(BROWSER_PRINT_AGENT_DEPLOY_VERSION_KEY);
    if (currentVersion === PRINT_AGENT_DEPLOY_VERSION) return;

    window.localStorage.setItem(BROWSER_PRINT_AGENT_DEPLOY_VERSION_KEY, PRINT_AGENT_DEPLOY_VERSION);
    clearTransientPrintAgentState();
    dispatchAgentReset();
    window.setTimeout(dispatchAgentConfigReload, 250);
    window.setTimeout(dispatchAgentConfigReload, 1500);
  }, []);

  return null;
}
