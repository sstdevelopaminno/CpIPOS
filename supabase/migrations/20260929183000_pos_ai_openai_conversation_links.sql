-- CpiPOS AI: keep durable conversation content in OpenAI while storing only a tiny
-- tenant/branch/user -> OpenAI conversation pointer in CpiPOS.
create table if not exists pos_ai_conversation_links (
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  user_id uuid not null references users_profiles(id) on delete cascade,
  openai_conversation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, branch_id, user_id),
  unique (openai_conversation_id)
);

create index if not exists idx_pos_ai_conversation_links_user
  on pos_ai_conversation_links(user_id, updated_at desc);

create trigger trg_pos_ai_conversation_links_touch
before update on pos_ai_conversation_links
for each row execute function app.touch_updated_at();

alter table pos_ai_conversation_links enable row level security;

comment on table pos_ai_conversation_links is
  'Server-only pointer table. AI message/content history lives in OpenAI Conversations; CpiPOS stores only the conversation ID per tenant/branch/user.';
