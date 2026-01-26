import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { useSalaoId } from "@/hooks/useSalaoId";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { FormPageShell } from "@/components/layout/FormPageShell";

type ClienteForm = {
  id?: string;
  nome: string;
  telefone?: string;
  email?: string;
  data_nascimento?: Date | null;
};

export default function ClienteFormPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { id } = useParams();
  const editingId = id && id !== "novo" ? id : null;

  const { data: salaoId } = useSalaoId();

  const [form, setForm] = useState<ClienteForm>({ nome: "", telefone: "", email: "", data_nascimento: null });

  const clienteQuery = useQuery({
    queryKey: ["cliente", editingId],
    enabled: !!editingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id,nome,telefone,email,data_nascimento")
        .eq("id", editingId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Cliente não encontrado");
      return data;
    },
  });

  useEffect(() => {
    if (!editingId) return;
    if (!clienteQuery.data) return;
    setForm({
      id: clienteQuery.data.id,
      nome: clienteQuery.data.nome,
      telefone: clienteQuery.data.telefone ?? "",
      email: clienteQuery.data.email ?? "",
      data_nascimento: clienteQuery.data.data_nascimento ? new Date(clienteQuery.data.data_nascimento) : null,
    });
  }, [clienteQuery.data, editingId]);

  const upsertMutation = useMutation({
    mutationFn: async (payload: ClienteForm) => {
      if (!salaoId) throw new Error("Cadastre o salão em Configurações antes.");
      const { error } = await supabase.from("clientes").upsert({
        id: payload.id,
        salao_id: salaoId,
        nome: payload.nome.trim(),
        telefone: payload.telefone?.trim() || null,
        email: payload.email?.trim() || null,
        data_nascimento: payload.data_nascimento ? format(payload.data_nascimento, "yyyy-MM-dd") : null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["clientes"] });
      toast({ title: "Cliente salvo" });
      nav("/clientes");
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const loading = clienteQuery.isLoading;
  const loadError = clienteQuery.error as any;

  return (
    <FormPageShell
      title={editingId ? "Editar cliente" : "Novo cliente"}
      actions={
        <>
          <Button variant="secondary" onClick={() => nav("/clientes")}>Voltar</Button>
          <Button
            onClick={() => {
              if (!form.nome.trim()) return toast({ title: "Informe o nome" });
              upsertMutation.mutate(form);
            }}
            disabled={upsertMutation.isPending || loading}
          >
            {upsertMutation.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      {!salaoId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Salão não cadastrado</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Vá em <Button variant="link" className="px-0" onClick={() => nav("/configuracoes")}>Configurações</Button> e cadastre o salão para liberar este formulário.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados do cliente</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? <div className="text-sm text-muted-foreground">Carregando…</div> : null}
          {loadError ? <div className="text-sm text-destructive">{loadError.message}</div> : null}

          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.nome.trim()) return toast({ title: "Informe o nome" });
              upsertMutation.mutate(form);
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" value={form.nome} onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tel">Telefone</Label>
              <Input id="tel" value={form.telefone ?? ""} onChange={(e) => setForm((p) => ({ ...p, telefone: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              />
            </div>
          <div className="grid gap-2">
            <Label htmlFor="data_nascimento">Data de nascimento</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id="data_nascimento"
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !form.data_nascimento && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {form.data_nascimento ? format(form.data_nascimento, "dd/MM/yyyy") : <span>Selecione uma data</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={form.data_nascimento ?? undefined}
                  onSelect={(date) => setForm((p) => ({ ...p, data_nascimento: date ?? null }))}
                  disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                  initialFocus
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => nav("/clientes")}>Cancelar</Button>
              <Button type="submit" disabled={upsertMutation.isPending || loading}>
                {upsertMutation.isPending ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </FormPageShell>
  );
}
