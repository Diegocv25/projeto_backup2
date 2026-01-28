import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/auth-context";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { toast } from "@/components/ui/use-toast";
import { usePortalSalaoByToken } from "@/hooks/usePortalSalaoByToken";

const clienteSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome").max(120),
  telefone: z.string().trim().max(40).optional(),
  email: z.string().trim().email("Informe um email válido").max(255).optional(),
});

function PortalShell({
  title,
  subtitle,
  children,
  onLogout,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onLogout?: () => void;
}) {
  return (
    <main className="mx-auto min-h-[calc(100vh-3rem)] max-w-2xl px-4 py-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {onLogout ? (
          <Button variant="secondary" onClick={onLogout}>
            Sair
          </Button>
        ) : null}
      </header>
      {children}
    </main>
  );
}

export default function ClientePortalAppPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { token } = useParams();
  const { user } = useAuth();
  const tokenValue = useMemo(() => (typeof token === "string" ? token.trim() : ""), [token]);

  const [skipEmailLink, setSkipEmailLink] = useState(false);

  const [form, setForm] = useState({
    nome: "",
    telefone: "",
    email: user?.email ?? "",
    dia_nascimento: "",
    mes_nascimento: "",
    ano_nascimento: "",
  });

  const salaoQuery = usePortalSalaoByToken(tokenValue);

  const clienteQuery = useQuery({
    queryKey: ["portal-cliente", salaoQuery.data?.id, user?.id],
    enabled: !!salaoQuery.data?.id && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clientes")
        .select("id,nome,telefone,email,data_nascimento")
        .eq("salao_id", salaoQuery.data!.id)
        .eq("auth_user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  const preCadastroQuery = useQuery({
    queryKey: ["portal-pre-cadastro-email", salaoQuery.data?.id, user?.email],
    enabled:
      !!user?.id &&
      !!user?.email &&
      !!salaoQuery.data?.id &&
      !clienteQuery.isLoading &&
      !clienteQuery.data &&
      !skipEmailLink,
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb.rpc("portal_find_cliente_by_email", {
        _salao_id: salaoQuery.data!.id,
        _email: user!.email,
      });
      if (error) throw error;
      const first = (data ?? [])[0] as { id: string; nome: string } | undefined;
      return first ?? null;
    },
  });

  const vincularPreCadastroMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Sessão inválida");
      if (!user.email) throw new Error("Email não encontrado");
      if (!salaoQuery.data?.id) throw new Error("Link inválido");

      const sb = supabase as any;
      const { data, error } = await sb.rpc("portal_link_cliente_by_email", {
        _salao_id: salaoQuery.data.id,
        _user_id: user.id,
        _email: user.email,
      });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: async (clienteId) => {
      if (clienteId) {
        await qc.invalidateQueries({ queryKey: ["portal-cliente"] });
        toast({ title: "Cadastro vinculado" });
      } else {
        // não encontrou/ não vinculou
        setSkipEmailLink(true);
      }
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  // garante o papel de cliente para aplicar as políticas RLS
  useEffect(() => {
    if (!user?.id) return;
    if (!salaoQuery.data?.id) return;
    (async () => {
      try {
        const sb = supabase as any;
        // Importante: NÃO usar upsert padrão aqui, pois ele pode cair em UPDATE e falhar por RLS.
        // Usamos ignoreDuplicates para gerar ON CONFLICT DO NOTHING.
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

  const criarClienteMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sessão inválida");
      if (!salaoQuery.data?.id) throw new Error("Link inválido");

      // IMPORTANTE: antes de inserir em `clientes`, precisamos garantir que o usuário
      // tenha `user_roles(customer)` para este salao_id. Caso contrário,
      // `has_customer_access(salao_id)` falha e o INSERT é bloqueado por RLS.
      // O useEffect que faz isso pode não ter concluído quando o usuário clica em "Salvar".
      try {
        const sb = supabase as any;
        await sb
          .from("user_roles")
          .upsert(
            { user_id: user.id, role: "customer", salao_id: salaoQuery.data.id },
            { onConflict: "user_id,salao_id,role", ignoreDuplicates: true } as any,
          );
      } catch {
        // Se falhar, o INSERT abaixo provavelmente falhará por RLS. Deixamos o erro aparecer.
      }

      const parsed = clienteSchema.safeParse({
        nome: form.nome,
        telefone: form.telefone || undefined,
        email: form.email || undefined,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Verifique os campos");

      // Constrói a data de nascimento se todos os campos estiverem preenchidos
      let dataNascimento: Date | null = null;
      if (form.dia_nascimento && form.mes_nascimento && form.ano_nascimento) {
        const dia = parseInt(form.dia_nascimento, 10);
        const mes = parseInt(form.mes_nascimento, 10) - 1; // JS months are 0-indexed
        const ano = parseInt(form.ano_nascimento, 10);
        dataNascimento = new Date(ano, mes, dia);
        // Valida se a data é válida
        if (
          dataNascimento.getDate() !== dia ||
          dataNascimento.getMonth() !== mes ||
          dataNascimento.getFullYear() !== ano
        ) {
          throw new Error("Data de nascimento inválida");
        }
      }

      const { error } = await supabase.from("clientes").insert({
        salao_id: salaoQuery.data.id,
        auth_user_id: user.id,
        nome: parsed.data.nome,
        telefone: parsed.data.telefone?.trim() || null,
        email: parsed.data.email?.trim() || null,
        data_nascimento: dataNascimento ? format(dataNascimento, "yyyy-MM-dd") : null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["portal-cliente"] });
      toast({ title: "Cadastro concluído" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <PortalShell
      title="Portal do cliente"
      subtitle={salaoQuery.data ? "Salão: " + salaoQuery.data.nome : ""}
      onLogout={async () => {
        await supabase.auth.signOut();
        nav("/cliente/" + tokenValue);
      }}
    >
      {tokenValue.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Link inválido</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Solicite um novo link ao salão.</CardContent>
        </Card>
      ) : salaoQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : salaoQuery.isError ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Erro ao validar link</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Tente novamente em instantes.</CardContent>
        </Card>
      ) : !salaoQuery.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Link não encontrado</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Solicite um novo link ao salão.</CardContent>
        </Card>
      ) : clienteQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando seu cadastro…</div>
      ) : !clienteQuery.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Novo cliente</CardTitle>
          </CardHeader>
          <CardContent>
            {preCadastroQuery.data ? (
              <Card className="mb-4">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Encontramos um cadastro neste salão</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Existe um cliente cadastrado neste salão com seu email.
                    {preCadastroQuery.data.nome ? ` Nome: ${preCadastroQuery.data.nome}.` : ""} Deseja vincular esse cadastro à sua conta?
                  </p>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="secondary" onClick={() => setSkipEmailLink(true)}>
                      Não vincular
                    </Button>
                    <Button type="button" onClick={() => vincularPreCadastroMutation.mutate()} disabled={vincularPreCadastroMutation.isPending}>
                      {vincularPreCadastroMutation.isPending ? "Vinculando…" : "Vincular"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                criarClienteMutation.mutate();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="nome">Nome</Label>
                <Input id="nome" value={form.nome} onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tel">Telefone</Label>
                <Input id="tel" value={form.telefone} onChange={(e) => setForm((p) => ({ ...p, telefone: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Data de nascimento</Label>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Select value={form.dia_nascimento} onValueChange={(v) => setForm((p) => ({ ...p, dia_nascimento: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Dia" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((dia) => (
                          <SelectItem key={dia} value={String(dia)}>
                            {dia}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Select value={form.mes_nascimento} onValueChange={(v) => setForm((p) => ({ ...p, mes_nascimento: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Mês" />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          { value: "1", label: "Janeiro" },
                          { value: "2", label: "Fevereiro" },
                          { value: "3", label: "Março" },
                          { value: "4", label: "Abril" },
                          { value: "5", label: "Maio" },
                          { value: "6", label: "Junho" },
                          { value: "7", label: "Julho" },
                          { value: "8", label: "Agosto" },
                          { value: "9", label: "Setembro" },
                          { value: "10", label: "Outubro" },
                          { value: "11", label: "Novembro" },
                          { value: "12", label: "Dezembro" },
                        ].map((mes) => (
                          <SelectItem key={mes.value} value={mes.value}>
                            {mes.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Select value={form.ano_nascimento} onValueChange={(v) => setForm((p) => ({ ...p, ano_nascimento: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Ano" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 127 }, (_, i) => new Date().getFullYear() - i).map((ano) => (
                          <SelectItem key={ano} value={String(ano)}>
                            {ano}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" onClick={() => nav("/cliente/" + tokenValue)}>
                  Voltar
                </Button>
                <Button type="submit" disabled={criarClienteMutation.isPending}>
                  {criarClienteMutation.isPending ? "Salvando…" : "Salvar"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-base">Serviços</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Veja valores e duração média de cada serviço.</p>
              <Button variant="secondary" className="w-full" onClick={() => nav("/cliente/" + tokenValue + "/servicos")}>
                Ver serviços
              </Button>
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-base">Novo agendamento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Escolha serviço, profissional e um horário disponível.</p>
              <Button className="w-full" onClick={() => nav("/cliente/" + tokenValue + "/novo")}>
                Agendar agora
              </Button>
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-base">Editar / cancelar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Veja seus agendamentos e, se necessário, edite ou cancele.</p>
              <Button variant="secondary" className="w-full" onClick={() => nav("/cliente/" + tokenValue + "/agendamentos")}>
                Ver agendamentos
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </PortalShell>
  );
}
