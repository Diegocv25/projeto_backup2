import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useSalaoId } from "@/hooks/useSalaoId";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { toFimDateExclusivo, toInicioDate } from "@/pages/relatorios/relatorios-utils";

const labels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function RelatoriosConcluidosPorDiaSemana({
  inicio,
  fim,
  onChangeInicio,
  onChangeFim,
}: {
  inicio: string;
  fim: string;
  onChangeInicio: (v: string) => void;
  onChangeFim: (v: string) => void;
}) {
  const { data: salaoId } = useSalaoId();
  const inicioDate = useMemo(() => toInicioDate(inicio), [inicio]);
  const fimDateExclusivo = useMemo(() => toFimDateExclusivo(fim), [fim]);

  const query = useQuery({
    queryKey: ["relatorios", "concluidos_por_dia_semana", { salaoId, inicio, fim }],
    enabled: !!salaoId && !!inicio && !!fim,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agendamentos")
        .select("data_hora_inicio")
        .eq("salao_id", salaoId as string)
        .eq("status", "concluido")
        .gte("data_hora_inicio", inicioDate.toISOString())
        .lt("data_hora_inicio", fimDateExclusivo.toISOString());

      if (error) throw error;

      const counts = Array.from({ length: 7 }, () => 0);
      (data ?? []).forEach((r: any) => {
        const d = new Date(String(r.data_hora_inicio));
        const dow = d.getUTCDay();
        if (Number.isFinite(dow)) counts[dow] += 1;
      });

      return { counts };
    },
  });

  return (
    <section className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Serviços concluídos por dia da semana</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Início</div>
              <Input type="date" value={inicio} onChange={(e) => onChangeInicio(e.target.value)} />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Fim</div>
              <Input type="date" value={fim} onChange={(e) => onChangeFim(e.target.value)} />
            </div>
          </div>

          {query.isLoading ? <div className="mt-3 text-xs text-muted-foreground">Carregando…</div> : null}
          {query.error ? <div className="mt-3 text-xs text-destructive">Erro ao carregar relatório.</div> : null}

          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead className="text-right">Concluídos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {labels.map((label, idx) => (
                  <TableRow key={label}>
                    <TableCell>{label}</TableCell>
                    <TableCell className="text-right tabular-nums">{query.data?.counts?.[idx] ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
