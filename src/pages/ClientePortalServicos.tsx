import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import { usePortalSalaoByToken } from "@/hooks/usePortalSalaoByToken";
import { getPortalSession } from "@/portal/portal-session";
import { portalServicos } from "@/portal/portal-api";

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

  const tokenValue = useMemo(() => (typeof token === "string" ? token.trim() : ""), [token]);

  const salaoQuery = usePortalSalaoByToken(tokenValue);

  const session = useMemo(() => (salaoQuery.data?.id ? getPortalSession(salaoQuery.data.id) : null), [salaoQuery.data?.id]);

  const servicosQuery = useQuery({
    queryKey: ["portal-servicos-lista", salaoQuery.data?.id],
    enabled: !!salaoQuery.data?.id && !!session?.sessionToken,
    queryFn: async () => {
      const res = await portalServicos({ token: tokenValue, session_token: session!.sessionToken });
      if (!res.ok) throw new Error("error" in res ? res.error : "Erro ao carregar serviços");
      return res.servicos;
    },
  });

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
