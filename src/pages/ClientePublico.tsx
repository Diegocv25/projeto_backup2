import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { usePortalSalaoByToken } from "@/hooks/usePortalSalaoByToken";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { z } from "zod";
import { portalLogin, portalSignup } from "@/portal/portal-api";
import { setPortalSession } from "@/portal/portal-session";

export default function ClientePublicoPage() {
  const nav = useNavigate();
  const { token } = useParams();

  const tokenValue = useMemo(() => (typeof token === "string" ? token.trim() : ""), [token]);

  // Valida o link via RPC (SECURITY DEFINER) para não depender de SELECT direto em `saloes` (RLS).
  const salaoQuery = usePortalSalaoByToken(tokenValue);

  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [form, setForm] = useState({ email: "", password: "", nome: "" });
  const [busy, setBusy] = useState(false);

  const emailSchema = z.string().trim().email().max(255);
  const passwordSchema = z.string().min(8).max(72);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-lg items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl">Portal do cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {tokenValue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Link inválido. Solicite um novo link ao salão.</p>
          ) : salaoQuery.isError ? (
            <p className="text-sm text-destructive">Erro ao validar link.</p>
          ) : salaoQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : salaoQuery.data ? (
            <>
              <p className="text-sm text-muted-foreground">
                {mode === "signup" ? "Primeiro acesso neste estabelecimento." : "Entre neste estabelecimento."} Salão:{" "}
                <span className="font-medium text-foreground">{salaoQuery.data.nome}</span>
              </p>

              <div className="flex gap-2">
                <Button variant={mode === "signup" ? "default" : "secondary"} onClick={() => setMode("signup")}>
                  Criar conta
                </Button>
                <Button variant={mode === "login" ? "default" : "secondary"} onClick={() => setMode("login")}>
                  Entrar
                </Button>
              </div>

              <form
                className="grid gap-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!salaoQuery.data?.id) return;
                  const email = form.email.trim().toLowerCase();
                  const password = form.password;
                  const nome = form.nome.trim();

                  const emailOk = emailSchema.safeParse(email);
                  if (!emailOk.success) return toast({ title: "Email inválido", variant: "destructive" });
                  const pwdOk = passwordSchema.safeParse(password);
                  if (!pwdOk.success) return toast({ title: "Senha inválida", description: "Mínimo 8 caracteres.", variant: "destructive" });

                  setBusy(true);
                  try {
                    const res =
                      mode === "signup"
                        ? await portalSignup({ token: tokenValue, email, password, nome: nome || undefined })
                        : await portalLogin({ token: tokenValue, email, password });

                    if (!res.ok) throw new Error("error" in res ? res.error : "Falha ao autenticar");

                    setPortalSession({
                      salaoId: res.salao_id,
                      sessionToken: res.session_token,
                      portalAccountId: res.portal_account_id,
                    });

                    nav(`/cliente/${tokenValue}/app`);
                  } catch (err: any) {
                    toast({ title: "Erro", description: err.message, variant: "destructive" });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {mode === "signup" ? (
                  <div className="grid gap-2">
                    <Label htmlFor="nome">Nome (opcional)</Label>
                    <Input id="nome" value={form.nome} onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))} />
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    autoComplete="email"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Senha</Label>
                  <Input
                    id="password"
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  />
                </div>
                <Button type="submit" disabled={busy}>
                  {busy ? "Aguarde…" : mode === "signup" ? "Criar conta" : "Entrar"}
                </Button>
              </form>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Link não encontrado ou expirado. Solicite um novo link ao salão.</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
