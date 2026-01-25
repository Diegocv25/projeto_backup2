-- Tabela de avisos semanais (um registro por salão/estabelecimento)
CREATE TABLE IF NOT EXISTS public.avisos_semanais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salao_id uuid NOT NULL,

  -- um campo por dia (texto livre; pode ser promo, informativo, etc.)
  seg text,
  ter text,
  qua text,
  qui text,
  sex text,
  sab text,
  dom text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT avisos_semanais_salao_unique UNIQUE (salao_id)
);

-- Índice para lookup rápido por tenant
CREATE INDEX IF NOT EXISTS idx_avisos_semanais_salao_id ON public.avisos_semanais (salao_id);

-- Trigger de updated_at (função já existe no projeto)
DROP TRIGGER IF EXISTS update_avisos_semanais_updated_at ON public.avisos_semanais;
CREATE TRIGGER update_avisos_semanais_updated_at
BEFORE UPDATE ON public.avisos_semanais
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- RLS (pode já estar auto-habilitado; repetimos por segurança)
ALTER TABLE public.avisos_semanais ENABLE ROW LEVEL SECURITY;

-- Políticas: somente admin/staff/gerente do salão atual
DROP POLICY IF EXISTS avisos_semanais_select_roles ON public.avisos_semanais;
CREATE POLICY avisos_semanais_select_roles
ON public.avisos_semanais
FOR SELECT
USING (
  salao_id = public.current_salao_id()
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
    OR public.has_role(auth.uid(), 'gerente'::public.app_role)
  )
);

DROP POLICY IF EXISTS avisos_semanais_insert_roles ON public.avisos_semanais;
CREATE POLICY avisos_semanais_insert_roles
ON public.avisos_semanais
FOR INSERT
WITH CHECK (
  salao_id = public.current_salao_id()
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
    OR public.has_role(auth.uid(), 'gerente'::public.app_role)
  )
);

DROP POLICY IF EXISTS avisos_semanais_update_roles ON public.avisos_semanais;
CREATE POLICY avisos_semanais_update_roles
ON public.avisos_semanais
FOR UPDATE
USING (
  salao_id = public.current_salao_id()
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
    OR public.has_role(auth.uid(), 'gerente'::public.app_role)
  )
)
WITH CHECK (
  salao_id = public.current_salao_id()
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
    OR public.has_role(auth.uid(), 'gerente'::public.app_role)
  )
);

DROP POLICY IF EXISTS avisos_semanais_delete_roles ON public.avisos_semanais;
CREATE POLICY avisos_semanais_delete_roles
ON public.avisos_semanais
FOR DELETE
USING (
  salao_id = public.current_salao_id()
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'staff'::public.app_role)
    OR public.has_role(auth.uid(), 'gerente'::public.app_role)
  )
);
