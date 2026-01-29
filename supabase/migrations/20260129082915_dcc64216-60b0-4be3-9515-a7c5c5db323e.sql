-- Portal do Cliente: autenticação isolada por estabelecimento (sem Supabase Auth)

-- 1) Tabela de contas do portal (por salão)
CREATE TABLE IF NOT EXISTS public.portal_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salao_id uuid NOT NULL REFERENCES public.saloes(id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  nome text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Email único por salão (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS portal_accounts_salao_email_uniq
  ON public.portal_accounts (salao_id, lower(email));

-- 2) Sessões do portal (token opaco, armazenar hash)
CREATE TABLE IF NOT EXISTS public.portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salao_id uuid NOT NULL REFERENCES public.saloes(id) ON DELETE CASCADE,
  portal_account_id uuid NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_sessions_account_idx ON public.portal_sessions (portal_account_id);
CREATE INDEX IF NOT EXISTS portal_sessions_salao_idx ON public.portal_sessions (salao_id);
CREATE INDEX IF NOT EXISTS portal_sessions_expires_idx ON public.portal_sessions (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS portal_sessions_token_hash_uniq ON public.portal_sessions (token_hash);

-- 3) Vincular cadastro operacional (clientes) à conta do portal (opcional, mas necessário para "meus agendamentos" sem auth.uid)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS portal_account_id uuid NULL REFERENCES public.portal_accounts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clientes_salao_portal_account_uniq
  ON public.clientes (salao_id, portal_account_id)
  WHERE portal_account_id IS NOT NULL;

-- 4) Updated_at trigger para portal_accounts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'update_portal_accounts_updated_at'
  ) THEN
    CREATE TRIGGER update_portal_accounts_updated_at
    BEFORE UPDATE ON public.portal_accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- 5) RLS: bloquear acesso direto via client (tudo via Edge Functions com service role)
ALTER TABLE public.portal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_sessions ENABLE ROW LEVEL SECURITY;

-- Portal accounts: negar SELECT/INSERT/UPDATE/DELETE para qualquer usuário via client
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='portal_accounts' AND policyname='portal_accounts_deny_all') THEN
    CREATE POLICY portal_accounts_deny_all
      ON public.portal_accounts
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;

-- Portal sessions: negar SELECT/INSERT/UPDATE/DELETE via client
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='portal_sessions' AND policyname='portal_sessions_deny_all') THEN
    CREATE POLICY portal_sessions_deny_all
      ON public.portal_sessions
      FOR ALL
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;
