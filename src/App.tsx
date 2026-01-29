import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AppLayout } from "@/components/layout/AppLayout";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

/*
PLANO TÉCNICO — AUTENTICAÇÃO ISOLADA DO PORTAL (SEM IMPLEMENTAR AGORA)

Por que o modelo atual está errado:
- Supabase Auth é global; se o cliente tem sessão, ele consegue entrar em qualquer /cliente/:token/*.
- O “gate” atual (AuthGate) usa auth.users e sessão global, o que viola a regra: cada salão é independente.
- O email existir em outro salão é detectável (pré-cadastro e login global), quebrando o isolamento.
- SignOut não resolve, pois a sessão global ainda é o único controle de acesso.

Refatoração correta esperada:
- Portal do cliente com autenticação própria por estabelecimento (multi-tenant real).
- Supabase Auth continua apenas para backoffice (donos/funcionários).
- Portal usa tabela própria (ex.: portal_accounts) e Edge Functions para login/cadastro.
- Sessão do portal deve ser própria (JWT/cookie httpOnly) e escopada ao salão.

Arquivos que precisam ser alterados (na implementação futura):
- src/App.tsx: remover AuthGate das rotas do portal; criar PortalGate específico.
- src/pages/ClientePublico.tsx: iniciar fluxo de login/cadastro via Edge Function.
- src/pages/ClientePortalApp.tsx: trocar useAuth + supabase.auth por sessão do portal.
- src/pages/ClientePortalMeusAgendamentos.tsx: usar identidade do portal e não auth.users.
- src/pages/ClientePortalAgendamentoForm.tsx: idem, buscar cliente via portal_account.
- src/pages/Auth.tsx: separar login backoffice vs portal (ou criar nova tela dedicada ao portal).
- (novo) hooks/portal-auth, edge functions login/signup, tabela portal_accounts + policies.

Novo fluxo de autenticação do Portal (proposto):
1) Cliente abre /cliente/:token → valida token → exibe tela de login/cadastro do portal.
2) Login/cadastro chama Edge Function (scoped ao salao_id) → cria/valida portal_account.
3) Edge Function emite sessão própria (JWT/cookie httpOnly) com salao_id + portal_account_id.
4) PortalGate valida sessão do portal (não Supabase Auth) e permite acesso ao /cliente/:token/*.
5) Mesmo email pode existir em vários salões com senhas diferentes (sem vazamento).
*/

import { AuthProvider } from "@/auth/auth-context";
import { AuthGate } from "@/auth/AuthGate";
import { PortalGate } from "@/auth/PortalGate";
import { AccessProvider } from "@/auth/access-context";
import { RoleGate } from "@/auth/RoleGate";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import AuthPage from "./pages/Auth";
import AgendamentosPage from "./pages/Agendamentos";
import AgendamentoFormPage from "./pages/AgendamentoFormPage";
import ClientesPage from "./pages/Clientes";
import ServicosPage from "./pages/Servicos";
import FuncionariosPage from "./pages/Funcionarios";
import RelatoriosPage from "./pages/Relatorios";
import ProdutosPage from "./pages/Produtos";
import ConfiguracoesPage from "./pages/Configuracoes";
import ClientePublicoPage from "./pages/ClientePublico";
import ClientePortalAppPage from "./pages/ClientePortalApp";
import ClientePortalMeusAgendamentosPage from "./pages/ClientePortalMeusAgendamentos";
import ClientePortalAgendamentoFormPage from "./pages/ClientePortalAgendamentoForm";
import ClientePortalServicosPage from "./pages/ClientePortalServicos";

import ProfissionalAgendamentosPage from "./pages/ProfissionalAgendamentos";
import ProfissionalAgendamentoFormPage from "./pages/ProfissionalAgendamentoFormPage";
import ProfissionalComissoesPage from "./pages/ProfissionalComissoes";

import ClienteFormPage from "./pages/ClienteFormPage";
import ServicoFormPage from "./pages/ServicoFormPage";
import FuncionarioFormPage from "./pages/FuncionarioFormPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
          <AccessProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/cliente/:token" element={<ClientePublicoPage />} />

              {/* Portal do cliente (sem sidebar) */}
              <Route element={<PortalGate />}>
                <Route path="/cliente/:token/app" element={<ClientePortalAppPage />} />
                <Route path="/cliente/:token/servicos" element={<ClientePortalServicosPage />} />
                <Route path="/cliente/:token/novo" element={<ClientePortalAgendamentoFormPage />} />
                <Route path="/cliente/:token/agendamentos" element={<ClientePortalMeusAgendamentosPage />} />
                <Route path="/cliente/:token/agendamentos/:id" element={<ClientePortalAgendamentoFormPage />} />
              </Route>

              <Route element={<AuthGate />}>
                <Route element={<AppLayout />}>
                  {/* Profissional */}
                  <Route element={<RoleGate allowed={["profissional"]} />}>
                    <Route path="/profissional/agendamentos" element={<ProfissionalAgendamentosPage />} />
                    <Route path="/profissional/agendamentos/novo" element={<ProfissionalAgendamentoFormPage />} />
                    <Route path="/profissional/agendamentos/:id" element={<ProfissionalAgendamentoFormPage />} />
                    <Route path="/profissional/comissoes" element={<ProfissionalComissoesPage />} />
                  </Route>

                  {/* Configurações (onboarding): acessível para usuário logado mesmo sem role */}
                  <Route path="/configuracoes" element={<ConfiguracoesPage />} />

                  {/* Admin/Gerente/Recepcionista/Staff */}
                  <Route element={<RoleGate allowed={["admin", "staff", "gerente", "recepcionista"]} />}>
                    <Route path="/" element={<Index />} />
                    <Route path="/agendamentos" element={<AgendamentosPage />} />
                    <Route path="/agendamentos/novo" element={<AgendamentoFormPage />} />
                    <Route path="/agendamentos/:id" element={<AgendamentoFormPage />} />

                    <Route path="/clientes" element={<ClientesPage />} />
                    <Route path="/clientes/novo" element={<ClienteFormPage />} />
                    <Route path="/clientes/:id" element={<ClienteFormPage />} />

                    <Route path="/servicos" element={<ServicosPage />} />
                    <Route path="/servicos/novo" element={<ServicoFormPage />} />
                    <Route path="/servicos/:id" element={<ServicoFormPage />} />

                    <Route path="/funcionarios" element={<FuncionariosPage />} />
                    <Route path="/funcionarios/novo" element={<FuncionarioFormPage />} />
                    <Route path="/funcionarios/:id" element={<FuncionarioFormPage />} />

                    <Route path="/produtos" element={<ProdutosPage />} />

                    <Route path="/relatorios" element={<RelatoriosPage />} />
                  </Route>
                </Route>
              </Route>

              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
          </AccessProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
