import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/auth/auth-context";
import { usePortalSalaoByToken } from "@/hooks/usePortalSalaoByToken";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ClientePublicoPage() {
  const nav = useNavigate();
  const { token } = useParams();
  const { user } = useAuth();

  const tokenValue = useMemo(() => (typeof token === "string" ? token.trim() : ""), [token]);

  // Fluxo desejado: ao abrir o link público, direcionar imediatamente para login/cadastro.
  useEffect(() => {
    if (!tokenValue) return;
    if (user) return;
    nav("/auth", {
      replace: true,
      state: { from: `/cliente/${tokenValue}/app`, allowSignup: true, portal: "cliente" },
    });
  }, [nav, tokenValue, user]);

  // Valida o link via RPC (SECURITY DEFINER) para não depender de SELECT direto em `saloes` (RLS).
  const salaoQuery = usePortalSalaoByToken(tokenValue);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-lg items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl">Portal do cliente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {user && salaoQuery.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}

          {tokenValue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Link inválido. Solicite um novo link ao salão.</p>
          ) : !user ? (
            <>
              <p className="text-sm text-muted-foreground">Para continuar, entre ou crie sua conta.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={() =>
                    nav("/auth", { state: { from: `/cliente/${tokenValue}/app`, allowSignup: true, portal: "cliente" } })
                  }
                >
                  Entrar / criar conta
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    nav("/auth", { state: { from: `/cliente/${tokenValue}/app`, allowSignup: true, portal: "cliente" } })
                  }
                >
                  Continuar
                </Button>
              </div>
            </>
          ) : salaoQuery.data ? (
            <>
              <p className="text-sm text-muted-foreground">
                Você está acessando o link público do salão <span className="font-medium text-foreground">{salaoQuery.data.nome}</span>.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => nav(`/cliente/${tokenValue}/app`)}>Continuar</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Próximo passo: aqui vamos listar serviços e horários disponíveis para agendamento.
              </p>
            </>
          ) : salaoQuery.isError ? (
            <p className="text-sm text-destructive">Erro ao validar link.</p>
          ) : (
            <p className="text-sm text-muted-foreground">Link não encontrado ou expirado. Solicite um novo link ao salão.</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
