import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("POS direct Support voice", () => {
  const nextConfig = src("next.config.ts");
  const chat = src("src/components/pos-preview/pos-support-chat.tsx");
  const voice = src("src/components/pos-preview/pos-support-voice.tsx");
  const hook = src("src/components/support/use-support-voice-call.ts");
  const route = src("src/app/api/pos/support-chat/conversations/[conversationId]/voice/route.ts");
  const messagesRoute = src("src/app/api/pos/support-chat/conversations/[conversationId]/messages/route.ts");
  const realtime = src("src/lib/supabase-browser.ts");
  const supportCenter = src("src/components/pos-preview/pos-support-center.tsx");

  it("allows same-origin microphone while retaining other permission restrictions", () => {
    expect(nextConfig).toContain("microphone=(self)");
    expect(nextConfig).not.toContain("microphone=()");
    expect(nextConfig).toContain("geolocation=()");
  });

  it("routes authenticated POS voice control through the shared Communications backend", () => {
    expect(route).toContain("requirePosSession()");
    expect(route).toContain('"request_voice_call"');
    expect(route).toContain('"accept_voice_call"');
    expect(route).toContain('"decline_voice_call"');
    expect(route).toContain('"cancel_voice_call"');
    expect(route).toContain('"get_voice_ice_config"');
    expect(route).toContain('"update_voice_call_state"');
    expect(route).toContain('"end_voice_call"');
    expect(route).toContain('"get_voice_queue_status"');
    expect(route).toContain('"voice_queue"');
    expect(route).toContain('data.origin = "cpipos_app"');
  });

  it("keeps voice attached to the canonical POS support conversation", () => {
    expect(messagesRoute).toContain("active_call");
    expect(chat).toContain("PosSupportVoice");
    expect(chat).toContain("activeCall");
    expect(chat).toContain("refreshSelectedConversation");
    expect(chat).toContain("voiceActive");
    expect(chat).toContain("กรุณาวางสายก่อนปิดหน้าต่างแชท");
    expect(voice).toContain('side: "store"');
    expect(voice).toContain("โทรหา Support");
    expect(voice).toContain("SpeechSynthesisUtterance");
    expect(voice).toContain("speakQueueAnnouncement(data.queue)");
    expect(voice).toContain("voice_queue");
    expect(voice).toContain("12_000 + Math.floor(Math.random() * 8_000)");
    expect(voice).toContain("2 ** Math.min(queuePollFailuresRef.current, 2)");
    expect(voice).toContain("60_000");
    expect(voice).toContain("source.loop = true");
    expect(supportCenter).toContain("ไม่จำเป็นต้องมี LINE");
  });

  it("shows FIFO waiting position without opening media early", () => {
    expect(voice).toContain('call.direction === "store_to_it" && call.status === "requested"');
    expect(voice).toContain("queuePosition={queue?.position}");
    expect(voice).toContain("stopWaitingMedia");
    expect(voice).toContain("กำลังติดต่อทีมซัพพอร์ต");
    expect(src("src/components/support/support-voice-call-overlay.tsx")).toContain("กำลังรอคิว Support");
    expect(src("src/components/support/support-voice-call-overlay.tsx")).toContain("ระหว่างรอยังไม่เปิดไมค์และยังไม่สร้างสาย WebRTC");
  });

  it("supports warm-transfer hold state and resilient WebRTC recovery", () => {
    expect(voice).toContain('"requested", "accepted", "returning"');
    expect(hook).toContain("track.enabled = !held");
    expect(hook).toContain("createBuffer");
    expect(hook).toContain("iceRestart");
    expect(hook).toContain('"webrtc_restart_request"');
    expect(hook).toContain("loadIceServers()");
    expect(hook).toContain("pc.setConfiguration");
    expect(hook).toContain("support-voice:");
    expect(hook).not.toContain('addEventListener("pagehide"');
  });

  it("keeps Realtime alive for long-running support sessions", () => {
    expect(realtime).toContain("let browserClient");
    expect(realtime).toContain("worker: true");
    expect(realtime).toContain("heartbeatCallback");
    expect(realtime).toContain("client.realtime.connect()");
  });
});
