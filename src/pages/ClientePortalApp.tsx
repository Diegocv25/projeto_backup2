import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import { getPortalSession, clearPortalSession } from "@/portal/portal-session";
import { portalLogout, portalUpsertCliente, portalWhoami } from "@/portal/portal-api";

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
  const tokenValue = useMemo(() => (typeof token === "string" ? token.trim() : ""), [token]);

  const [form, setForm] = useState({
    nome: "",
    telefone: "",
    email: "",
    dia_nascimento: "",
    mes_nascimento: "",
    ano_nascimento: "",
  });

  const salaoQuery = usePortalSalaoByToken(tokenValue);

  const session = useMemo(() => (salaoQuery.data?.id ? getPortalSession(salaoQuery.data.id) : null), [salaoQuery.data?.id]);

  const whoamiQuery = useQuery({
    queryKey: ["portal-whoami", salaoQuery.data?.id, session?.sessionToken],
    enabled: !!salaoQuery.data?.id && !!session?.sessionToken,
    queryFn: async () => {
      const res = await portalWhoami({ token: tokenValue, session_token: session!.sessionToken });
      if (!res.ok) throw new Error("error" in res ? res.error : "Sessão inválida");
      return res;
    },
    retry: false,
  });

  // Preenche email/nome (se existir) a partir do whoami
  useEffect(() => {
    if (!whoamiQuery.data?.ok) return;
    setForm((p) => ({
      ...p,
      email: p.email || whoamiQuery.data.email || "",
      nome: p.nome || whoamiQuery.data.nome || "",
    }));
  }, [whoamiQuery.data]);

  const criarClienteMutation = useMutation({
    mutationFn: async () => {
      if (!salaoQuery.data?.id) throw new Error("Link inválido");
      if (!session?.sessionToken) throw new Error("Sessão do portal inválida");

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

      const res = await portalUpsertCliente({
        token: tokenValue,
        session_token: session.sessionToken,
        nome: parsed.data.nome,
        telefone: parsed.data.telefone?.trim() || null,
        email: parsed.data.email?.trim() || null,
        data_nascimento: dataNascimento ? format(dataNascimento, "yyyy-MM-dd") : null,
      });
      if (!res.ok) throw new Error("error" in res ? res.error : "Falha ao salvar" );
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
        if (salaoQuery.data?.id && session?.sessionToken) {
          await portalLogout({ token: tokenValue, session_token: session.sessionToken });
          clearPortalSession(salaoQuery.data.id);
        }
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
      ) : whoamiQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando sua sessão…</div>
      ) : !whoamiQuery.data?.ok ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sessão inválida</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Faça login novamente.
            <div className="mt-3">
              <Button onClick={() => nav(`/cliente/${tokenValue}`)}>Ir para login</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seu cadastro neste estabelecimento</CardTitle>
          </CardHeader>
          <CardContent>
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
      )}
    </PortalShell>
  );
}
