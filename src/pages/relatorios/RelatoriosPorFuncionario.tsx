import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useSalaoId } from "@/hooks/useSalaoId";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { formatBRL, safeNumber, toFimDateExclusivo, toInicioDate } from "@/pages/relatorios/relatorios-utils";

type Row = {
  funcionario: string;
  servicosRealizados: number;
  comissaoPaga: number;
  comissaoPendente: number;
  receitaBruta: number;
  rendaSalao: number;
};

export default function RelatoriosPorFuncionario({ inicio, fim }: { inicio: string; fim: string }) {
  const { data: salaoId } = useSalaoId();
  const inicioDate = useMemo(() => toInicioDate(inicio), [inicio]);
  const fimDateExclusivo = useMemo(() => toFimDateExclusivo(fim), [fim]);

  const porFuncionarioQuery = useQuery({
    queryKey: ["relatorios", "por_funcionario", { salaoId, inicio, fim }],
    enabled: !!salaoId && !!inicio && !!fim,
    queryFn: async () => {
      const [funcs, ags, comCalc, comPagas, comPendentes] = await Promise.all([
        supabase.from("funcionarios").select("id,nome").eq("salao_id", salaoId as string),

        supabase
          .from("agendamentos")
          .select("id,funcionario_id,total_valor")
          .eq("salao_id", salaoId as string)
          .eq("status", "concluido")
          .gte("data_hora_inicio", inicioDate.toISOString())
          .lt("data_hora_inicio", fimDateExclusivo.toISOString()),

        supabase
          .from("comissoes")
          .select("agendamento_id,funcionario_id,valor_calculado")
          .eq("salao_id", salaoId as string)
          .gte("created_at", inicioDate.toISOString())
          .lt("created_at", fimDateExclusivo.toISOString()),

        supabase
          .from("comissoes")
          .select("funcionario_id,valor_calculado")
          .eq("salao_id", salaoId as string)
          .not("pago_em", "is", null)
          .gte("pago_em", inicioDate.toISOString())
          .lt("pago_em", fimDateExclusivo.toISOString()),

        supabase
          .from("comissoes")
          .select("funcionario_id,valor_calculado")
          .eq("salao_id", salaoId as string)
          .is("pago_em", null)
          .gte("created_at", inicioDate.toISOString())
          .lt("created_at", fimDateExclusivo.toISOString()),
      ]);

      const errors = [funcs.error, ags.error, comCalc.error, comPagas.error, comPendentes.error].filter(Boolean);
      if (errors.length) throw errors[0];

      const nomePorId = new Map<string, string>((funcs.data ?? []).map((f: any) => [String(f.id), String(f.nome ?? "(Sem nome)")]));

      const acc = new Map<string, Row>();
      const ensure = (funcId: string) => {
        const nome = nomePorId.get(funcId) ?? "(Sem nome)";
        const key = funcId;
        if (!acc.has(key)) {
          acc.set(key, {
            funcionario: nome,
            servicosRealizados: 0,
            comissaoPaga: 0,
            comissaoPendente: 0,
            receitaBruta: 0,
            rendaSalao: 0,
          });
        }
        return acc.get(key)!;
      };

      const comCalcByAgendamento = new Map<string, number>();
      (comCalc.data ?? []).forEach((c: any) => {
        comCalcByAgendamento.set(String(c.agendamento_id), safeNumber(c.valor_calculado));
      });

      (ags.data ?? []).forEach((a: any) => {
        const funcId = String(a.funcionario_id);
        const r = ensure(funcId);
        r.servicosRealizados += 1;
        r.receitaBruta += safeNumber(a.total_valor);
        const comCalcValor = comCalcByAgendamento.get(String(a.id)) ?? 0;
        r.rendaSalao += safeNumber(a.total_valor) - comCalcValor;
      });

      (comPagas.data ?? []).forEach((c: any) => {
        const funcId = String(c.funcionario_id);
        const r = ensure(funcId);
        r.comissaoPaga += safeNumber(c.valor_calculado);
      });

      (comPendentes.data ?? []).forEach((c: any) => {
        const funcId = String(c.funcionario_id);
        const r = ensure(funcId);
        r.comissaoPendente += safeNumber(c.valor_calculado);
      });

      const rows = Array.from(acc.values())
        .filter((r) => r.servicosRealizados > 0 || r.comissaoPaga > 0 || r.receitaBruta > 0)
        .sort((a, b) => b.rendaSalao - a.rendaSalao);

      return { rows };
    },
  });

  return (
    <section>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comparativo por funcionário (período)</CardTitle>
        </CardHeader>
        <CardContent>
          {porFuncionarioQuery.isLoading ? <div className="text-xs text-muted-foreground">Carregando…</div> : null}
          {porFuncionarioQuery.error ? <div className="text-xs text-destructive">Erro ao carregar.</div> : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Funcionário</TableHead>
                <TableHead className="text-right">Serviços</TableHead>
                <TableHead className="text-right">Comissão paga</TableHead>
                <TableHead className="text-right">Comissão não paga</TableHead>
                <TableHead className="text-right">Receita bruta</TableHead>
                <TableHead className="text-right">Renda p/ salão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(porFuncionarioQuery.data?.rows ?? []).map((r) => (
                <TableRow key={r.funcionario}>
                  <TableCell className="max-w-[260px] truncate">{r.funcionario}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.servicosRealizados}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(r.comissaoPaga)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(r.comissaoPendente)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(r.receitaBruta)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(r.rendaSalao)}</TableCell>
                </TableRow>
              ))}

              {(porFuncionarioQuery.data?.rows ?? []).length === 0 && !porFuncionarioQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    Nenhum dado no período.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}
