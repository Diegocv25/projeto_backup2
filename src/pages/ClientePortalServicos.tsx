import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/auth-context";
import { usePortalSalaoByToken } from "@/hooks/usePortalSalaoByToken";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function PortalShell({
  title,
  subtitle,
  children,
  onBack,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <main className="mx-auto min-h-[calc(100vh-3rem)] max-w-3xl px-4 py-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        <Button variant="secondary" onClick={onBack}>
          Voltar
        </Button>
      </header>
      {children}
    </main>
  );
}

export default function ClientePortalServicosPage() {
  const nav = useNavigate();
  const { token } = useParams();
  const { user } = useAuth();

  const tokenValue = useMemo(() => (typeof token === "string" ? token.trim() : ""), [token]);

  const salaoQuery = usePortalSalaoByToken(tokenValue);

  // garante o papel de cliente para aplicar as políticas RLS (mesmo se o usuário entrar direto nesta rota)
  useEffect(() => {
    if (!user?.id) return;
    if (!salaoQuery.data?.id) return;
    (async () => {
      try {
        const sb = supabase as any;
        await sb
          .from("user_roles")
          .upsert({ user_id: user.id, role: "customer", salao_id: salaoQuery.data.id }, { onConflict: "user_id,salao_id,role" } as any);
      } catch {
        // ignore
      }
    })();
  }, [user?.id, salaoQuery.data?.id]);

  const servicosQuery = useQuery({
    queryKey: ["portal-servicos-lista", salaoQuery.data?.id],
    enabled: !!salaoQuery.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("servicos")
        .select("id,nome,duracao_minutos,valor,ativo")
        .eq("salao_id", salaoQuery.data!.id)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!user) {
    return (
      <PortalShell title="Serviços" onBack={() => nav(`/cliente/${tokenValue}`)}>
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">Faça login para continuar.</CardContent>
        </Card>
      </PortalShell>
    );
  }

  return (
    <PortalShell
      title="Serviços"
      subtitle={salaoQuery.data ? `Salão: ${salaoQuery.data.nome}` : undefined}
      onBack={() => nav(`/cliente/${tokenValue}/app`)}
    >
      {!tokenValue ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">Link inválido.</CardContent>
        </Card>
      ) : salaoQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : salaoQuery.isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">Erro ao validar link. Tente novamente.</CardContent>
        </Card>
      ) : !salaoQuery.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Link não encontrado</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Solicite um novo link ao salão.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Lista de serviços</CardTitle>
            </CardHeader>
            <CardContent>
              {servicosQuery.isLoading ? <div className="text-sm text-muted-foreground">Carregando…</div> : null}
              {servicosQuery.isError ? <div className="text-sm text-destructive">Erro ao carregar serviços.</div> : null}

              {!servicosQuery.isLoading && !servicosQuery.isError ? (
                <div className="grid gap-3">
                  {(servicosQuery.data ?? []).map((s: any) => (
                    <div key={s.id} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium leading-tight">{s.nome}</div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {Number(s.duracao_minutos)} min • R$ {Number(s.valor).toFixed(2)}
                          </div>
                        </div>
                        <Button size="sm" onClick={() => nav(`/cliente/${tokenValue}/novo`)}>
                          Agendar
                        </Button>
                      </div>
                    </div>
                  ))}

                  {(servicosQuery.data ?? []).length === 0 ? (
                    <div className="text-sm text-muted-foreground">Nenhum serviço disponível no momento.</div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </PortalShell>
  );
}
