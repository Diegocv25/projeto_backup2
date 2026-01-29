import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useNavigate, useParams } from "react-router-dom";

import { usePortalSalaoByToken } from "@/hooks/usePortalSalaoByToken";
import { getPortalSession } from "@/portal/portal-session";
import { portalCancelAgendamento, portalMeusAgendamentos } from "@/portal/portal-api";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/use-toast";

function PortalShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-[calc(100vh-3rem)] max-w-3xl px-4 py-10">
      <header className="mb-6 flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </header>
      {children}
    </main>
  );
}

export default function ClientePortalMeusAgendamentosPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { token } = useParams();
  const tokenValue = useMemo(() => (typeof token === "string" ? token.trim() : ""), [token]);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const salaoQuery = usePortalSalaoByToken(tokenValue);

  const session = useMemo(() => (salaoQuery.data?.id ? getPortalSession(salaoQuery.data.id) : null), [salaoQuery.data?.id]);

  const agendamentosQuery = useQuery({
    queryKey: ["portal-meus-agendamentos", salaoQuery.data?.id, session?.sessionToken],
    enabled: !!salaoQuery.data?.id && !!session?.sessionToken,
    queryFn: async () => {
      const res = await portalMeusAgendamentos({ token: tokenValue, session_token: session!.sessionToken });
      if (!res.ok) throw new Error("error" in res ? res.error : "Erro ao carregar agendamentos");
      return res.agendamentos;
    },
  });

  const cancelarMutation = useMutation({
    mutationFn: async (vars: { id: string; status: "cancelado" }) => {
      if (!session?.sessionToken) throw new Error("Sessão inválida");
      const res = await portalCancelAgendamento({ token: tokenValue, session_token: session.sessionToken, agendamento_id: vars.id });
      if (!res.ok) throw new Error("error" in res ? res.error : "Não foi possível cancelar este agendamento.");
    },
    onSuccess: async (_data, vars) => {
      // Atualização otimista para refletir imediatamente na lista
      qc.setQueryData(["portal-meus-agendamentos", salaoQuery.data?.id, session?.sessionToken], (old: any) => {
        const arr = Array.isArray(old) ? old : [];
        return arr.map((a: any) => (String(a?.id) === String(vars.id) ? { ...a, status: "cancelado" } : a));
      });

      setCancelId(null);
      await qc.invalidateQueries({ queryKey: ["portal-meus-agendamentos", salaoQuery.data?.id] });
      toast({ title: "Agendamento cancelado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <PortalShell title="Meus agendamentos">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" onClick={() => nav(`/cliente/${tokenValue}/app`)}>
          Voltar
        </Button>
        <Button onClick={() => nav(`/cliente/${tokenValue}/novo`)}>Novo agendamento</Button>
      </div>

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
      ) : (
        <div className="space-y-3">
          {(agendamentosQuery.data ?? []).map((a: any) => {
            const dt = parseISO(String(a.data_hora_inicio));
            const profNome = a.funcionario_nome || "Profissional";
            const servicoNome = a.servico_nome || undefined;
            return (
              <Card key={a.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{format(dt, "dd/MM/yyyy 'às' HH:mm")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-sm text-muted-foreground">
                    {profNome}
                    {servicoNome ? ` • ${servicoNome}` : ""} • {Number(a.total_duracao_minutos)} min • R$ {Number(a.total_valor).toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">Status: {String(a.status)}</div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button
                      variant="secondary"
                      disabled={String(a.status) === "cancelado" || String(a.status) === "concluido"}
                      onClick={() => nav(`/cliente/${tokenValue}/agendamentos/${a.id}`)}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={String(a.status) === "cancelado" || String(a.status) === "concluido"}
                      onClick={() => setCancelId(String(a.id))}
                    >
                      Cancelar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {!agendamentosQuery.isLoading && (agendamentosQuery.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">Você ainda não tem agendamentos.</CardContent>
            </Card>
          ) : null}
        </div>
      )}

      <AlertDialog open={!!cancelId} onOpenChange={(v) => !v && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar agendamento?</AlertDialogTitle>
            <AlertDialogDescription>Você poderá agendar novamente quando quiser.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelarMutation.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelarMutation.isPending || !cancelId}
              onClick={() => (cancelId ? cancelarMutation.mutate({ id: cancelId, status: "cancelado" }) : null)}
            >
              {cancelarMutation.isPending ? "Cancelando…" : "Cancelar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalShell>
  );
}
