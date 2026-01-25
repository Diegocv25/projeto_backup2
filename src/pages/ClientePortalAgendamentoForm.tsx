import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/auth-context";
import { useAvailableSlots } from "@/hooks/useAvailableSlots";
import { usePortalSalaoByToken } from "@/hooks/usePortalSalaoByToken";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";

type IdName = { id: string; nome: string };

type LoadedAgendamento = {
  id: string;
  cliente_id: string;
  funcionario_id: string;
  data_hora_inicio: string;
  total_duracao_minutos: number;
  total_valor: number;
  observacoes: string | null;
  status: "marcado" | "confirmado" | "concluido" | "cancelado";
  itens: Array<{ servico_id: string }>;
};

const observacoesSchema = z.string().trim().max(800).optional();

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

export default function ClientePortalAgendamentoFormPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { token, id } = useParams();
  const { user } = useAuth();
  const [search] = useSearchParams();

  const tokenValue = useMemo(() => (typeof token === "string" ? token.trim() : ""), [token]);
  const agendamentoId = id ? String(id) : null;
  const isEdit = !!agendamentoId;

  const initialDate = search.get("date");
  const [servicoId, setServicoId] = useState<string>("");
  const [funcionarioId, setFuncionarioId] = useState<string>("");
  const [data, setData] = useState<string>(initialDate ?? format(new Date(), "yyyy-MM-dd"));
  const [hora, setHora] = useState<string>("");
  const [observacoes, setObservacoes] = useState<string>("");

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

  const agendamentoQuery = useQuery({
    queryKey: ["portal-agendamento", agendamentoId],
    enabled: !!agendamentoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agendamentos")
        .select(
          "id,cliente_id,funcionario_id,data_hora_inicio,total_duracao_minutos,total_valor,observacoes,status,itens:agendamento_itens(servico_id)",
        )
        .eq("id", agendamentoId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Agendamento não encontrado.");
      return data as unknown as LoadedAgendamento;
    },
  });

  useEffect(() => {
    if (!agendamentoQuery.data) return;
    const a = agendamentoQuery.data;
    const dt = new Date(a.data_hora_inicio);
    setFuncionarioId(a.funcionario_id);
    setObservacoes(a.observacoes ?? "");
    setData(format(dt, "yyyy-MM-dd"));
    setHora(format(dt, "HH:mm"));
    const firstServico = a.itens?.[0]?.servico_id;
    if (firstServico) setServicoId(firstServico);
  }, [agendamentoQuery.data]);

  const servicosQuery = useQuery({
    queryKey: ["portal-servicos"],
    enabled: !!salaoQuery.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("servicos")
        .select("id,nome,duracao_minutos,valor,ativo")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  const selectedServico = useMemo(() => {
    const s = (servicosQuery.data ?? []).find((x: any) => x.id === servicoId);
    if (!s) return null;
    return {
      id: s.id as string,
      nome: s.nome as string,
      duracao_minutos: Number(s.duracao_minutos),
      valor: Number(s.valor),
    };
  }, [servicosQuery.data, servicoId]);

  const profissionaisQuery = useQuery({
    queryKey: ["portal-profissionais-por-servico", servicoId],
    enabled: !!servicoId,
    queryFn: async () => {
      const { data: links, error: linkErr } = await supabase
        .from("servicos_funcionarios")
        .select("funcionario_id")
        .eq("servico_id", servicoId);
      if (linkErr) throw linkErr;

      const ids = Array.from(new Set((links ?? []).map((l: any) => l.funcionario_id as string)));
      if (ids.length === 0) return [] as IdName[];

      // Segurança: clientes não têm SELECT direto em `funcionarios` (contém dados sensíveis).
      // Usamos RPC que retorna somente {id,nome} e já filtra por tenant/ativo/profissional.
      const sb = supabase as any;
      const { data: fun, error: funErr } = await sb.rpc("funcionarios_public_by_ids", { _ids: ids });
      if (funErr) throw funErr;

      return (fun ?? []) as IdName[];
    },
  });

  useEffect(() => {
    setFuncionarioId("");
    setHora("");
  }, [servicoId]);

  useEffect(() => {
    setHora("");
  }, [funcionarioId, data]);

  const slotsQuery = useAvailableSlots({
    funcionarioId: funcionarioId || null,
    data: data || null,
    serviceDurationMinutes: selectedServico?.duracao_minutos ?? null,
    salaoId: salaoQuery.data?.id ?? null,
    excludeAgendamentoId: isEdit && agendamentoQuery.data ? agendamentoQuery.data.id : null,
    usePortalRpc: true,
  });

  const policyMode = String(salaoQuery.data?.agendamento_antecedencia_modo ?? "horas");
  const policyHours = Number(salaoQuery.data?.agendamento_antecedencia_horas ?? 0);
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const tomorrowStr = format(addDays(new Date(), 1), "yyyy-MM-dd");
  const minDate = policyMode === "proximo_dia" ? tomorrowStr : todayStr;

  const filteredSlots = useMemo(() => {
    const slots = (slotsQuery.data ?? []) as string[];
    if (!data) return slots;

    const now = new Date();
    const safetyNow = new Date(now.getTime() + 60_000);

    const original = agendamentoQuery.data ? new Date(agendamentoQuery.data.data_hora_inicio) : null;
    const originalDay = original ? format(original, "yyyy-MM-dd") : null;
    const originalTime = original ? format(original, "HH:mm") : null;

    if (policyMode === "proximo_dia") {
      if (data < tomorrowStr) {
        if (isEdit && originalDay === data && originalTime && slots.includes(originalTime)) {
          return [originalTime, ...slots.filter((s) => s !== originalTime)];
        }
        return [];
      }
      return slots;
    }

    if (data !== todayStr) return slots;
    const threshold = new Date(safetyNow.getTime() + Math.max(0, policyHours) * 60 * 60 * 1000);
    const out = slots.filter((t) => new Date(`${data}T${t}:00`) >= threshold);

    if (isEdit && originalDay === data && originalTime && slots.includes(originalTime) && !out.includes(originalTime)) {
      return [originalTime, ...out];
    }

    return out;
  }, [slotsQuery.data, data, policyMode, policyHours, todayStr, tomorrowStr, isEdit, agendamentoQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!salaoQuery.data?.id) throw new Error("Link inválido.");
      if (!clienteQuery.data?.id) throw new Error("Conclua seu cadastro de cliente antes.");
      if (!selectedServico) throw new Error("Selecione um serviço.");
      if (!funcionarioId) throw new Error("Selecione um profissional.");
      if (!data) throw new Error("Selecione a data.");
      if (!hora) throw new Error("Selecione um horário disponível.");

      const obsParsed = observacoesSchema.safeParse(observacoes);
      if (!obsParsed.success) throw new Error(obsParsed.error.issues[0]?.message ?? "Observações inválidas");

      const inicioLocal = new Date(`${data}T${hora}:00`);
      const now = new Date();
      const safetyNow = new Date(now.getTime() + 60_000);
      if (inicioLocal < safetyNow) throw new Error("Não é possível agendar em um horário que já passou.");

      if (!isEdit) {
        const { data: saved, error } = await supabase
          .from("agendamentos")
          .insert({
            salao_id: salaoQuery.data.id,
            cliente_id: clienteQuery.data.id,
            funcionario_id: funcionarioId,
            data_hora_inicio: inicioLocal.toISOString(),
            total_duracao_minutos: selectedServico.duracao_minutos,
            total_valor: selectedServico.valor,
            status: "marcado",
            observacoes: obsParsed.data?.trim() ? obsParsed.data.trim() : null,
          })
          .select("id")
          .maybeSingle();
        if (error) throw error;
        const newId = saved?.id;
        if (!newId) throw new Error("Falha ao salvar agendamento.");

        const { error: itemErr } = await supabase.from("agendamento_itens").insert({
          agendamento_id: newId,
          servico_id: selectedServico.id,
          duracao_minutos: selectedServico.duracao_minutos,
          valor: selectedServico.valor,
        });
        if (itemErr) throw itemErr;
        return newId;
      }

      const { error: updErr } = await supabase
        .from("agendamentos")
        .update({
          funcionario_id: funcionarioId,
          data_hora_inicio: inicioLocal.toISOString(),
          total_duracao_minutos: selectedServico.duracao_minutos,
          total_valor: selectedServico.valor,
          observacoes: obsParsed.data?.trim() ? obsParsed.data.trim() : null,
        })
        .eq("id", agendamentoId as string);
      if (updErr) throw updErr;

      // 1 serviço (MVP) -> reescreve itens
      const { error: delItemErr } = await supabase.from("agendamento_itens").delete().eq("agendamento_id", agendamentoId as string);
      if (delItemErr) throw delItemErr;

      const { error: itemErr } = await supabase.from("agendamento_itens").insert({
        agendamento_id: agendamentoId as string,
        servico_id: selectedServico.id,
        duracao_minutos: selectedServico.duracao_minutos,
        valor: selectedServico.valor,
      });
      if (itemErr) throw itemErr;

      return agendamentoId;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["portal-meus-agendamentos"] }),
        qc.invalidateQueries({ queryKey: ["portal-agendamento"] }),
      ]);
      toast({ title: isEdit ? "Agendamento atualizado" : "Agendamento criado" });
      nav(`/cliente/${tokenValue}/agendamentos`);
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  if (!user) {
    return (
      <PortalShell title="Portal do cliente" onBack={() => nav(`/cliente/${tokenValue}`)}>
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">Faça login para continuar.</CardContent>
        </Card>
      </PortalShell>
    );
  }

  return (
    <PortalShell
      title={isEdit ? "Editar agendamento" : "Novo agendamento"}
      subtitle="Selecione serviço, profissional e um horário realmente livre."
      onBack={() => nav(`/cliente/${tokenValue}/agendamentos`)}
    >
      {!tokenValue ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">Link inválido.</CardContent>
        </Card>
      ) : salaoQuery.isLoading || clienteQuery.isLoading || (isEdit && agendamentoQuery.isLoading) ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados do agendamento</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                saveMutation.mutate();
              }}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Serviço</Label>
                  <Select value={servicoId} onValueChange={setServicoId}>
                    <SelectTrigger>
                      <SelectValue placeholder={servicosQuery.isLoading ? "Carregando…" : "Selecione"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(servicosQuery.data ?? []).map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Profissional</Label>
                  <Select value={funcionarioId} onValueChange={setFuncionarioId} disabled={!servicoId}>
                    <SelectTrigger>
                      <SelectValue placeholder={!servicoId ? "Escolha um serviço" : profissionaisQuery.isLoading ? "Carregando…" : "Selecione"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(profissionaisQuery.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label>Data</Label>
                  <Input type="date" min={minDate} value={data} onChange={(e) => setData(e.target.value)} />
                </div>

                <div className="grid gap-2">
                  <Label>Horário</Label>
                  <Select value={hora} onValueChange={setHora} disabled={!funcionarioId || !selectedServico}>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          !funcionarioId
                            ? "Selecione profissional"
                            : slotsQuery.isLoading
                              ? "Carregando…"
                              : slotsQuery.isError
                                ? "Erro ao carregar"
                                : "Selecione"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredSlots.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                      {!slotsQuery.isLoading && slotsQuery.isError ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Não foi possível carregar os horários. Tente novamente.
                        </div>
                      ) : null}
                      {!slotsQuery.isLoading && filteredSlots.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">Sem horários disponíveis</div>
                      ) : null}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Observações (opcional)</Label>
                <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" onClick={() => nav(`/cliente/${tokenValue}/agendamentos`)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Salvando…" : "Salvar"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </PortalShell>
  );
}
