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

async function createConversation(scope: AiConversationScope): Promise<string> {
  const conversation = await openAiFetch<OpenAiConversation>("/conversations", {
    method: "POST",
    body: JSON.stringify({
      metadata: {
        app: "cpipos",
        tenant_id: scope.tenantId,
        branch_id: scope.branchId,
        user_id: scope.userId,
        role: scope.role
      }
    })
  });
  if (!conversation.id) throw new Error("OpenAI conversation ID was not returned.");
  return conversation.id;
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

export async function getOrCreateAiConversation(scope: AiConversationScope): Promise<string> {
  const db = getSupabaseServiceClient();
  const { data, error } = await db
    .from("pos_ai_conversation_links")
    .select("openai_conversation_id")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId)
    .maybeSingle<{ openai_conversation_id: string }>();

  if (error) throw new Error(`ai_conversation_link_lookup_failed:${error.message}`);

  if (data?.openai_conversation_id) {
    if (await conversationExists(data.openai_conversation_id)) {
      return data.openai_conversation_id;
    }
  }

  const conversationId = await createConversation(scope);
  const { error: upsertError } = await db
    .from("pos_ai_conversation_links")
    .upsert({
      tenant_id: scope.tenantId,
      branch_id: scope.branchId,
      user_id: scope.userId,
      openai_conversation_id: conversationId
    }, { onConflict: "tenant_id,branch_id,user_id" });

  if (upsertError) {
    throw new Error(`ai_conversation_link_write_failed:${upsertError.message}`);
  }
  return conversationId;
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

export async function listAiConversationMessages(conversationId: string, maxMessages = 60): Promise<AiStoredMessage[]> {
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

export async function deleteAiConversationForUser(scope: AiConversationScope): Promise<void> {
  const db = getSupabaseServiceClient();
  const { data } = await db
    .from("pos_ai_conversation_links")
    .select("openai_conversation_id")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId)
    .maybeSingle<{ openai_conversation_id: string }>();

  if (data?.openai_conversation_id) {
    const conversationId = data.openai_conversation_id;
    try {
      // OpenAI conversation deletion does not delete its items, so remove every
      // item explicitly before deleting the conversation container.
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

  const { error } = await db
    .from("pos_ai_conversation_links")
    .delete()
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId);
  if (error) throw new Error(`ai_conversation_link_delete_failed:${error.message}`);
}
