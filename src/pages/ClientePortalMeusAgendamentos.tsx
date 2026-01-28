import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useNavigate, useParams } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/auth-context";
import { usePortalSalaoByToken } from "@/hooks/usePortalSalaoByToken";

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
  const { user } = useAuth();
  const tokenValue = useMemo(() => (typeof token === "string" ? token.trim() : ""), [token]);
  const [cancelId, setCancelId] = useState<string | null>(null);

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
          .upsert(
            { user_id: user.id, role: "customer", salao_id: salaoQuery.data.id },
            { onConflict: "user_id,salao_id,role", ignoreDuplicates: true } as any,
          );
      } catch {
        // ignore
      }
    })();
  }, [user?.id, salaoQuery.data?.id]);

  const clienteQuery = useQuery({
    queryKey: ["portal-cliente", salaoQuery.data?.id, user?.id],
    enabled: !!salaoQuery.data?.id && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id,nome")
        .eq("salao_id", salaoQuery.data!.id)
        .eq("auth_user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  const agendamentosQuery = useQuery({
    queryKey: ["portal-meus-agendamentos", clienteQuery.data?.id],
    enabled: !!clienteQuery.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agendamentos")
        .select(
          // NOTE: cliente não deve depender de JOIN direto em `funcionarios` (RLS pode ocultar).
          "id,data_hora_inicio,status,total_valor,total_duracao_minutos,funcionario_id,itens:agendamento_itens(servico:servicos(nome))",
        )
        .eq("cliente_id", clienteQuery.data!.id)
        .order("data_hora_inicio", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const profissionaisMapQuery = useQuery({
    queryKey: [
      "portal-profissionais-map",
      (agendamentosQuery.data ?? []).map((a: any) => a.funcionario_id).filter(Boolean).sort().join(","),
    ],
    enabled: (agendamentosQuery.data ?? []).length > 0,
    queryFn: async () => {
      const ids = Array.from(new Set((agendamentosQuery.data ?? []).map((a: any) => String(a.funcionario_id)).filter(Boolean)));
      if (ids.length === 0) return new Map<string, string>();

      const sb = supabase as any;
      const { data, error } = await sb.rpc("funcionarios_public_by_ids", { _ids: ids });
      if (error) throw error;
      const map = new Map<string, string>();
      for (const row of data ?? []) map.set(String(row.id), String(row.nome));
      return map;
    },
  });

  const cancelarMutation = useMutation({
    // Mesmo formato da gestão (update de status), mas no portal usamos RPC para não falhar por RLS.
    mutationFn: async (vars: { id: string; status: "cancelado" }) => {
      const sb = supabase as any;
      const { data, error } = await sb.rpc("portal_cancel_agendamento", { _agendamento_id: vars.id });
      if (error) throw error;
      if (!data || (Array.isArray(data) && data.length === 0)) {
        throw new Error("Não foi possível cancelar este agendamento.");
      }
    },
    onSuccess: async (_data, vars) => {
      const clienteId = clienteQuery.data?.id;

      // Atualização otimista para refletir imediatamente na lista
      if (clienteId) {
        qc.setQueryData(["portal-meus-agendamentos", clienteId], (old: any) => {
          const arr = Array.isArray(old) ? old : [];
          return arr.map((a: any) => (String(a?.id) === String(vars.id) ? { ...a, status: "cancelado" } : a));
        });
      }

      setCancelId(null);
      await qc.invalidateQueries({ queryKey: ["portal-meus-agendamentos", clienteId] });
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
       ) : salaoQuery.isLoading || clienteQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
       ) : salaoQuery.isError ? (
         <Card>
           <CardContent className="py-6 text-sm text-muted-foreground">Erro ao validar link. Tente novamente.</CardContent>
         </Card>
      ) : !clienteQuery.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cadastro necessário</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Conclua seu cadastro como cliente antes.
            <div className="mt-3">
              <Button onClick={() => nav(`/cliente/${tokenValue}/app`)}>Ir para cadastro</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(agendamentosQuery.data ?? []).map((a: any) => {
            const servicoNome = (a.itens as any)?.[0]?.servico?.nome as string | undefined;
            const dt = parseISO(String(a.data_hora_inicio));
            const profNome =
              (profissionaisMapQuery.data?.get(String(a.funcionario_id)) ??
                // fallback (se ainda carregando)
                (profissionaisMapQuery.isLoading ? "Carregando…" : null)) ||
              "Profissional";
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
