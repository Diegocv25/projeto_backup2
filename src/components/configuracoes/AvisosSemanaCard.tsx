import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";

type AvisosSemana = {
  seg: string;
  ter: string;
  qua: string;
  qui: string;
  sex: string;
  sab: string;
  dom: string;
};

const schema = z.object({
  seg: z.string().max(500, "Máx. 500 caracteres").optional(),
  ter: z.string().max(500, "Máx. 500 caracteres").optional(),
  qua: z.string().max(500, "Máx. 500 caracteres").optional(),
  qui: z.string().max(500, "Máx. 500 caracteres").optional(),
  sex: z.string().max(500, "Máx. 500 caracteres").optional(),
  sab: z.string().max(500, "Máx. 500 caracteres").optional(),
  dom: z.string().max(500, "Máx. 500 caracteres").optional(),
});

const empty: AvisosSemana = { seg: "", ter: "", qua: "", qui: "", sex: "", sab: "", dom: "" };

export function AvisosSemanaCard({
  salaoId,
  canEdit,
}: {
  salaoId: string | null | undefined;
  canEdit: boolean;
}) {
  const qc = useQueryClient();

  const avisosQuery = useQuery({
    queryKey: ["avisos-semanais", salaoId],
    enabled: !!salaoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("avisos_semanais")
        .select("id,seg,ter,qua,qui,sex,sab,dom")
        .eq("salao_id", salaoId as string)
        .maybeSingle();

      if (error) throw error;
      return {
        id: (data as any)?.id as string | undefined,
        values: {
          seg: String((data as any)?.seg ?? ""),
          ter: String((data as any)?.ter ?? ""),
          qua: String((data as any)?.qua ?? ""),
          qui: String((data as any)?.qui ?? ""),
          sex: String((data as any)?.sex ?? ""),
          sab: String((data as any)?.sab ?? ""),
          dom: String((data as any)?.dom ?? ""),
        } satisfies AvisosSemana,
      };
    },
  });

  const [form, setForm] = useState<AvisosSemana>(empty);

  // sincroniza quando carregar
  useEffect(() => {
    if (!avisosQuery.data) return;
    setForm(avisosQuery.data.values);
  }, [avisosQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!salaoId) throw new Error("Salão não encontrado");
      if (!canEdit) throw new Error("Sem permissão para editar avisos");

      const parsed = schema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Verifique os campos");

      const payload = {
        salao_id: salaoId,
        seg: parsed.data.seg?.trim() || null,
        ter: parsed.data.ter?.trim() || null,
        qua: parsed.data.qua?.trim() || null,
        qui: parsed.data.qui?.trim() || null,
        sex: parsed.data.sex?.trim() || null,
        sab: parsed.data.sab?.trim() || null,
        dom: parsed.data.dom?.trim() || null,
      };

      const { error } = await supabase.from("avisos_semanais").upsert(payload, { onConflict: "salao_id" });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["avisos-semanais"] });
      toast({ title: "Avisos salvos" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const disabled = !salaoId || !canEdit || saveMutation.isPending;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Avisos da semana</CardTitle>
          <div className="text-xs text-muted-foreground">
            Mensagens por dia (ex.: promoções). Sua automação (n8n) pode ler estes campos.
          </div>
        </div>
        <Button type="button" onClick={() => saveMutation.mutate()} disabled={disabled}>
          {saveMutation.isPending ? "Salvando…" : "Salvar avisos"}
        </Button>
      </CardHeader>
      <CardContent>
        {!salaoId ? <div className="text-sm text-muted-foreground">Salve o estabelecimento primeiro.</div> : null}
        {avisosQuery.isLoading ? <div className="text-sm text-muted-foreground">Carregando…</div> : null}
        {avisosQuery.error ? (
          <div className="text-sm text-destructive">Erro ao carregar avisos (ou sem permissão).</div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <DayField label="Segunda" value={form.seg} onChange={(v) => setForm((p) => ({ ...p, seg: v }))} disabled={disabled} />
          <DayField label="Terça" value={form.ter} onChange={(v) => setForm((p) => ({ ...p, ter: v }))} disabled={disabled} />
          <DayField label="Quarta" value={form.qua} onChange={(v) => setForm((p) => ({ ...p, qua: v }))} disabled={disabled} />
          <DayField label="Quinta" value={form.qui} onChange={(v) => setForm((p) => ({ ...p, qui: v }))} disabled={disabled} />
          <DayField label="Sexta" value={form.sex} onChange={(v) => setForm((p) => ({ ...p, sex: v }))} disabled={disabled} />
          <DayField label="Sábado" value={form.sab} onChange={(v) => setForm((p) => ({ ...p, sab: v }))} disabled={disabled} />
          <div className="md:col-span-2">
            <DayField label="Domingo" value={form.dom} onChange={(v) => setForm((p) => ({ ...p, dom: v }))} disabled={disabled} />
          </div>
        </div>

        {!canEdit ? (
          <div className="mt-3 text-xs text-muted-foreground">Somente Admin/Staff/Gerente pode editar estes avisos.</div>
        ) : (
          <div className="mt-3 text-xs text-muted-foreground">Dica: deixe vazio para não enviar aviso naquele dia.</div>
        )}
      </CardContent>
    </Card>
  );
}

function DayField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Escreva o aviso deste dia…"
        disabled={disabled}
      />
    </div>
  );
}
