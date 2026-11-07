
-- Private server-side announcements shared by CpIPOS IT and CpIPOS Web POS.
-- Authenticated tenant/user scope is enforced by their respective API handlers.
CREATE TABLE IF NOT EXISTS public.platform_news_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 180),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
  image_url text,
  link_url text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at timestamptz,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_news_live_idx ON public.platform_news_posts(status,published_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS platform_news_target_idx ON public.platform_news_posts(target_tenant_id,status,published_at DESC);

CREATE TABLE IF NOT EXISTS public.platform_news_reads (
  news_id uuid NOT NULL REFERENCES public.platform_news_posts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(news_id,tenant_id,user_id)
);
CREATE INDEX IF NOT EXISTS platform_news_reads_user_idx ON public.platform_news_reads(tenant_id,user_id,read_at DESC);

ALTER TABLE public.platform_news_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_news_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_news_posts FROM anon, authenticated, PUBLIC;
REVOKE ALL ON TABLE public.platform_news_reads FROM anon, authenticated, PUBLIC;

-- Image uploads are strictly performed by an authorized IT server endpoint,
-- not by public browser storage permissions. Published images are publicly readable.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('platform-news','platform-news',true,2097152,ARRAY['image/png','image/jpeg','image/webp']::text[])
ON CONFLICT (id) DO NOTHING;
