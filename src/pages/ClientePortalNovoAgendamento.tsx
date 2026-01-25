import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function PortalShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-[calc(100vh-3rem)] max-w-2xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </header>
      {children}
    </main>
  );
}

export default function ClientePortalNovoAgendamentoPage() {
  const nav = useNavigate();
  const { token } = useParams();
  const tokenValue = useMemo(() => (typeof token === "string" ? token.trim() : ""), [token]);

  return (
    <PortalShell title="Novo agendamento" subtitle="Selecione cliente, serviço, profissional e um horário realmente livre.">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Em construção</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Próximo passo: vamos reutilizar o mesmo formulário de agendamento, mas limitado ao seu cadastro.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="secondary" onClick={() => nav(`/cliente/${tokenValue}/app`)}>
              Voltar
            </Button>
            <Button onClick={() => nav(`/cliente/${tokenValue}/agendamentos`)}>Ver meus agendamentos</Button>
          </div>
        </CardContent>
      </Card>
    </PortalShell>
  );
}
