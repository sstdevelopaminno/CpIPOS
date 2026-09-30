import "server-only";

import { readEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type AiConversationScope = {
  tenantId: string;
  branchId: string;
  userId: string;
  role: string;
};

export type AiStoredMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type AiChatRoom = {
  id: string;
  title: string;
  openai_conversation_id: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
};

type OpenAiConversation = {
  id: string;
  object?: string;
  metadata?: Record<string, string>;
};

type ConversationItem = {
  id?: string;
  type?: string;
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type ConversationItemsPage = {
  data?: ConversationItem[];
  has_more?: boolean;
  last_id?: string | null;
};

type RoomRow = AiChatRoom & {
  tenant_id: string;
  branch_id: string;
  user_id: string;
};

function apiKey() {
  const key = readEnv("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY is not configured for CpiPOS AI.");
  return key;
}

async function openAiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`https://api.openai.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as T | { error?: { message?: string } } | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: { message?: string } }).error?.message ?? "OpenAI request failed.")
      : "OpenAI request failed.";
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

function cleanRoomTitle(value: unknown, fallback = "แชทใหม่") {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return text || fallback;
}

export function roomTitleFromMessage(message: string) {
  return cleanRoomTitle(message.replace(/[\r\n]+/g, " "));
}

async function createConversation(scope: AiConversationScope, roomId: string, title: string): Promise<string> {
  const conversation = await openAiFetch<OpenAiConversation>("/conversations", {
    method: "POST",
    body: JSON.stringify({
      metadata: {
        app: "cpipos",
        room_id: roomId,
        tenant_id: scope.tenantId,
        branch_id: scope.branchId,
        user_id: scope.userId,
        role: scope.role,
        title: cleanRoomTitle(title)
      }
    })
  });
  if (!conversation.id) throw new Error("OpenAI conversation ID was not returned.");
  return conversation.id;
}

async function updateConversationMetadata(conversationId: string, metadata: Record<string, string>) {
  await openAiFetch<OpenAiConversation>(`/conversations/${encodeURIComponent(conversationId)}`, {
    method: "POST",
    body: JSON.stringify({ metadata })
  });
}

async function conversationExists(conversationId: string): Promise<boolean> {
  try {
    await openAiFetch<OpenAiConversation>(`/conversations/${encodeURIComponent(conversationId)}`);
    return true;
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 404) return false;
    throw error;
  }
}

function roomSelect() {
  return "id,title,openai_conversation_id,created_at,updated_at,last_message_at,tenant_id,branch_id,user_id";
}

export async function listAiChatRooms(scope: AiConversationScope): Promise<AiChatRoom[]> {
  const db = getSupabaseServiceClient();
  const { data, error } = await db
    .from("pos_ai_chat_rooms")
    .select(roomSelect())
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId)
    .order("last_message_at", { ascending: false })
    .limit(100)
    .returns<RoomRow[]>();

  if (error) throw new Error(`ai_chat_room_list_failed:${error.message}`);
  return (data ?? []).map(({ tenant_id: _tenant, branch_id: _branch, user_id: _user, ...room }) => room);
}

export async function getAiChatRoom(scope: AiConversationScope, roomId: string): Promise<AiChatRoom | null> {
  const db = getSupabaseServiceClient();
  const { data, error } = await db
    .from("pos_ai_chat_rooms")
    .select(roomSelect())
    .eq("id", roomId)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId)
    .maybeSingle<RoomRow>();

  if (error) throw new Error(`ai_chat_room_lookup_failed:${error.message}`);
  if (!data) return null;

  const exists = await conversationExists(data.openai_conversation_id);
  if (!exists) {
    await db.from("pos_ai_chat_rooms").delete().eq("id", data.id);
    return null;
  }
  const { tenant_id: _tenant, branch_id: _branch, user_id: _user, ...room } = data;
  return room;
}

export async function createAiChatRoom(scope: AiConversationScope, title = "แชทใหม่"): Promise<AiChatRoom> {
  const db = getSupabaseServiceClient();
  const roomId = crypto.randomUUID();
  const roomTitle = cleanRoomTitle(title);
  const conversationId = await createConversation(scope, roomId, roomTitle);
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("pos_ai_chat_rooms")
    .insert({
      id: roomId,
      tenant_id: scope.tenantId,
      branch_id: scope.branchId,
      user_id: scope.userId,
      openai_conversation_id: conversationId,
      title: roomTitle,
      last_message_at: now
    })
    .select(roomSelect())
    .single<RoomRow>();

  if (error) {
    try {
      await deleteOpenAiConversationById(conversationId);
    } catch {
      // Best effort cleanup after local pointer failure.
    }
    throw new Error(`ai_chat_room_create_failed:${error.message}`);
  }

  const { tenant_id: _tenant, branch_id: _branch, user_id: _user, ...room } = data;
  return room;
}

export async function getOrCreateAiChatRoom(scope: AiConversationScope, roomId?: string | null): Promise<AiChatRoom> {
  if (roomId) {
    const room = await getAiChatRoom(scope, roomId);
    if (room) return room;
  }
  const rooms = await listAiChatRooms(scope);
  if (rooms[0]) {
    const room = await getAiChatRoom(scope, rooms[0].id);
    if (room) return room;
  }
  return createAiChatRoom(scope);
}

export async function renameAiChatRoom(scope: AiConversationScope, roomId: string, title: string): Promise<AiChatRoom> {
  const db = getSupabaseServiceClient();
  const room = await getAiChatRoom(scope, roomId);
  if (!room) throw new Error("ai_chat_room_not_found");
  const nextTitle = cleanRoomTitle(title);

  const { data, error } = await db
    .from("pos_ai_chat_rooms")
    .update({ title: nextTitle })
    .eq("id", room.id)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId)
    .select(roomSelect())
    .single<RoomRow>();

  if (error) throw new Error(`ai_chat_room_rename_failed:${error.message}`);

  try {
    await updateConversationMetadata(room.openai_conversation_id, {
      app: "cpipos",
      room_id: room.id,
      tenant_id: scope.tenantId,
      branch_id: scope.branchId,
      user_id: scope.userId,
      role: scope.role,
      title: nextTitle
    });
  } catch {
    // The local room index remains authoritative for display.
  }

  const { tenant_id: _tenant, branch_id: _branch, user_id: _user, ...result } = data;
  return result;
}

export async function touchAiChatRoom(scope: AiConversationScope, roomId: string, firstMessage?: string | null) {
  const db = getSupabaseServiceClient();
  const room = await getAiChatRoom(scope, roomId);
  if (!room) throw new Error("ai_chat_room_not_found");

  const patch: Record<string, unknown> = { last_message_at: new Date().toISOString() };
  if (room.title === "แชทใหม่" && firstMessage) {
    patch.title = roomTitleFromMessage(firstMessage);
  }
  const { data, error } = await db
    .from("pos_ai_chat_rooms")
    .update(patch)
    .eq("id", room.id)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId)
    .select(roomSelect())
    .single<RoomRow>();
  if (error) throw new Error(`ai_chat_room_touch_failed:${error.message}`);

  if (typeof patch.title === "string") {
    try {
      await updateConversationMetadata(room.openai_conversation_id, {
        app: "cpipos",
        room_id: room.id,
        tenant_id: scope.tenantId,
        branch_id: scope.branchId,
        user_id: scope.userId,
        role: scope.role,
        title: patch.title
      });
    } catch {
      // Non-blocking metadata sync.
    }
  }

  const { tenant_id: _tenant, branch_id: _branch, user_id: _user, ...result } = data;
  return result;
}

export async function addAiConversationItems(conversationId: string, items: Array<Record<string, unknown>>): Promise<void> {
  if (!items.length) return;
  await openAiFetch(
    `/conversations/${encodeURIComponent(conversationId)}/items`,
    {
      method: "POST",
      body: JSON.stringify({ items: items.slice(0, 20) })
    }
  );
}

function textFromItem(item: ConversationItem) {
  if (item.type !== "message") return "";
  return (item.content ?? [])
    .filter((part) => part.type === "input_text" || part.type === "output_text")
    .map((part) => String(part.text ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function listAiConversationMessages(conversationId: string, maxMessages = 100): Promise<AiStoredMessage[]> {
  const collected: ConversationItem[] = [];
  let after: string | null = null;

  while (collected.length < maxMessages) {
    const params = new URLSearchParams({
      order: "desc",
      limit: String(Math.min(100, maxMessages - collected.length))
    });
    if (after) params.set("after", after);

    const page = await openAiFetch<ConversationItemsPage>(
      `/conversations/${encodeURIComponent(conversationId)}/items?${params.toString()}`
    );
    const items = page.data ?? [];
    collected.push(...items);
    if (!page.has_more || !page.last_id || items.length === 0) break;
    after = page.last_id;
  }

  return collected
    .filter((item) => item.type === "message" && (item.role === "user" || item.role === "assistant"))
    .map((item) => ({
      id: String(item.id ?? crypto.randomUUID()),
      role: item.role as "user" | "assistant",
      text: textFromItem(item)
    }))
    .filter((item) => item.text)
    .slice(0, maxMessages)
    .reverse();
}

export async function deleteOpenAiConversationById(conversationId: string): Promise<void> {
  try {
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page = await openAiFetch<ConversationItemsPage>(
        `/conversations/${encodeURIComponent(conversationId)}/items?order=desc&limit=100`
      );
      const ids = (page.data ?? []).map((item) => String(item.id ?? "")).filter(Boolean);
      if (!ids.length) break;
      for (const itemId of ids) {
        await openAiFetch(
          `/conversations/${encodeURIComponent(conversationId)}/items/${encodeURIComponent(itemId)}`,
          { method: "DELETE" }
        );
      }
      if (!page.has_more) break;
    }
    await openAiFetch(`/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status !== 404) throw error;
  }
}

export async function deleteAiChatRoom(scope: AiConversationScope, roomId: string): Promise<void> {
  const db = getSupabaseServiceClient();
  const room = await getAiChatRoom(scope, roomId);
  if (!room) return;

  await deleteOpenAiConversationById(room.openai_conversation_id);

  const [deleted, redacted] = await Promise.all([
    db.from("pos_ai_chat_rooms")
      .delete()
      .eq("id", room.id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("user_id", scope.userId),
    db.from("pos_ai_usage_events")
      .update({ prompt_text: null, history_cleared_at: new Date().toISOString() })
      .eq("tenant_id", scope.tenantId)
      .eq("openai_conversation_id", room.openai_conversation_id)
  ]);

  if (deleted.error) throw new Error(`ai_chat_room_delete_failed:${deleted.error.message}`);
  if (redacted.error) throw new Error(`ai_chat_room_usage_redact_failed:${redacted.error.message}`);
}

export async function deleteAllAiChatRoomsForUser(scope: AiConversationScope): Promise<number> {
  const rooms = await listAiChatRooms(scope);
  for (const room of rooms) await deleteAiChatRoom(scope, room.id);
  return rooms.length;
}

export async function pruneExpiredAiChatRooms(scope: AiConversationScope, retentionDays: number | null | undefined): Promise<number> {
  const days = Number(retentionDays ?? 0);
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = new Date(Date.now() - Math.trunc(days) * 24 * 60 * 60 * 1000).toISOString();
  const db = getSupabaseServiceClient();
  const { data, error } = await db
    .from("pos_ai_chat_rooms")
    .select("id")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId)
    .lt("last_message_at", cutoff)
    .limit(100)
    .returns<Array<{ id: string }>>();
  if (error) throw new Error(`ai_chat_room_retention_scan_failed:${error.message}`);

  for (const room of data ?? []) {
    await deleteAiChatRoom(scope, room.id);
  }
  return (data ?? []).length;
}

// Backward-compatible helpers used by older call sites during the room migration.
export async function getOrCreateAiConversation(scope: AiConversationScope): Promise<string> {
  return (await getOrCreateAiChatRoom(scope)).openai_conversation_id;
}

export async function deleteAiConversationForUser(scope: AiConversationScope): Promise<void> {
  await deleteAllAiChatRoomsForUser(scope);
}
