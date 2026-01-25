import { useEffect, useMemo, useRef } from "react";
import { Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { ThemeToggle } from "@/components/ThemeToggle";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { useEstabelecimentoId } from "@/hooks/useEstabelecimentoId";

export function AppLayout() {
  const seededRef = useRef(false);
  const estabelecimentoIdQuery = useEstabelecimentoId();
  const estabelecimentoId = estabelecimentoIdQuery.data ?? null;

  const estabelecimentoNomeQuery = useQuery({
    queryKey: ["estabelecimento-nome", estabelecimentoId],
    enabled: !!estabelecimentoId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saloes")
        .select("nome")
        .eq("id", estabelecimentoId as string)
        .maybeSingle();

      if (error) throw error;
      return data?.nome ?? null;
    },
  });

  const headerTitle = useMemo(() => {
    const nome = estabelecimentoNomeQuery.data;
    return nome ? `Gestão — ${nome}` : "Gestão";
  }, [estabelecimentoNomeQuery.data]);

  useEffect(() => {
    // Sem botão: tenta criar dados fictícios 1x por navegador (função é idempotente)
    if (seededRef.current) return;
    seededRef.current = true;

    const already = localStorage.getItem("demoSeed:v1");
    if (already) return;

    (async () => {
      const { error } = await supabase.functions.invoke("seed-demo-data", { body: {} });
      if (!error) {
        localStorage.setItem("demoSeed:v1", "1");
        toast({ title: "Demo pronta", description: "Dados fictícios carregados para você testar o sistema." });
      }
      // silencia erro (ex.: sem permissão) para evitar travar o app
    })();
  }, []);

  return (
    <SidebarProvider>
      <div className="flex min-h-svh w-full bg-background">
        <AppSidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b bg-background/80 px-3 backdrop-blur">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <div className="text-sm font-medium">{headerTitle}</div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
            </div>
          </header>

          <main className="flex-1 min-h-0 overflow-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
