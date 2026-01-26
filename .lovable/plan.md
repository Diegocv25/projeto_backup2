
Objetivo
- Permitir que um novo usuário “empresa” (criado pela sua landing page, ou manualmente para testes) consiga:
  1) fazer login,
  2) entrar em /configuracoes mesmo sem role,
  3) criar/configurar o estabelecimento (saloes + dias_funcionamento),
  4) clicar em “Definir este usuário como Admin (1ª vez)” e então passar a ter acesso total ao sistema daquele tenant.
- Manter o app principal sem cadastro de empresa (somente login). O cadastro de cliente continua existindo apenas dentro do portal público (/cliente/:token), e o cliente fica restrito ao tenant do token.

Contexto do que existe hoje (por que hoje não escala multi-tenant via UI)
- Rotas:
  - /configuracoes está atrás de <RoleGate allowed={["admin","staff","gerente","recepcionista"]}>. Usuário “novo” (sem role) não entra nessa rota.
- Banco / RLS:
  - Para um usuário sem user_roles, current_salao_id() retorna NULL.
  - As policies atuais de saloes e dias_funcionamento exigem id/current_salao_id e roles, então o usuário novo não consegue nem criar o salao, nem salvar horários.
  - can_bootstrap_first_admin() hoje é global (impede o “segundo admin” no sistema inteiro), o que bloqueia multi-tenant via fluxo UI.

Decisões confirmadas com você
- Empresa: 1 usuário = 1 empresa (um login admin por tenant).
- Cadastro no app (empresa): desativado (somente login).
- Portal do cliente: manter cadastro, mas sempre restrito ao tenant do token (já é o comportamento desejado).

Solução proposta (visão geral)
A) Ajustes no Banco (RLS + função)
1) Adicionar uma “âncora de propriedade temporária” para onboarding:
   - Nova coluna em public.saloes: created_by_user_id uuid (nullable ou não; recomendado nullable com default).
   - Em onboarding (usuário sem role), o usuário só pode ver/editar o salao que ele mesmo criou (created_by_user_id = auth.uid()).
   - Isso evita o risco de “ver salões órfãos” de outros tenants e deixa o fluxo seguro.

2) Liberar INSERT/UPDATE controlado para onboarding em:
   - public.saloes
   - public.dias_funcionamento
   (apenas enquanto o usuário ainda não tem roles e apenas para o salao criado por ele, e somente até o salao ganhar um admin)

3) Alterar can_bootstrap_first_admin() para deixar de ser global e passar a ser “por usuário”:
   - Antes: só permite se não existir nenhum admin no sistema.
   - Depois: permite se ESTE user ainda não é admin de nenhum tenant.
   - Isso habilita múltiplos tenants, cada um com seu próprio admin.

4) Fortalecer policy de INSERT em public.user_roles no bootstrap:
   - Além de user_id = auth.uid() e role = 'admin', validar que:
     - o salao_id existe,
     - ainda não tem admin,
     - e (recomendado) saloes.created_by_user_id = auth.uid() (para o usuário só conseguir “claim” do próprio estabelecimento criado).

B) Ajustes no Frontend (roteamento + UX)
1) Permitir acesso a /configuracoes mesmo sem role (para onboarding)
   - Hoje /configuracoes está dentro do RoleGate de “backoffice”.
   - Vamos separar /configuracoes em uma rota própria que:
     - exija login (AuthGate),
     - mas NÃO exija role (ou use um gate específico que permita role null).
   - Alternativa adicional (boa prática): quando role for null, redirecionar o usuário automaticamente para /configuracoes em vez de “/” (evita loop).

2) Manter “sem cadastro de empresa” no /auth
   - Hoje, o “signup” só aparece quando AuthGate define allowSignup para rotas do portal do cliente.
   - Vamos reforçar isso no /auth para não depender de “qualquer state”:
     - Só habilitar signup se (location.state.portal === "cliente") OU se a rota de origem for /cliente/...
     - Resultado: mesmo que alguém tente forçar o state no browser, o app não mostrará signup para empresa.

3) Pequenas melhorias de texto no /configuracoes
   - Atualizar a observação “isso só funciona na primeira vez (quando ainda não existe nenhum Admin no sistema)” para refletir o novo comportamento:
     - “isso funciona no primeiro acesso de cada empresa (quando o estabelecimento ainda não tem um admin)”.

Detalhamento técnico (o que será implementado)

A) Migração SQL (schema + RLS)
1) Schema
- ALTER TABLE public.saloes
  - ADD COLUMN created_by_user_id uuid NULL
  - DEFAULT auth.uid() (ou definido via trigger BEFORE INSERT)
  - Observação: default com auth.uid() é prático para inserts via app. Se preferirmos 100% explícito, podemos setar no frontend no upsert, mas isso expõe o campo ao cliente (a policy precisa garantir que created_by_user_id = auth.uid()).

2) Policies em public.saloes
- Manter as policies atuais para usuários com role (tenant normal).
- Adicionar policies específicas de onboarding:
  - SELECT: permitir se created_by_user_id = auth.uid() E usuário não tem roles ainda
  - INSERT: permitir se usuário não tem roles ainda E WITH CHECK created_by_user_id = auth.uid()
  - UPDATE: permitir se created_by_user_id = auth.uid() E usuário não tem roles ainda E o salao ainda não tem admin
  - (DELETE opcional) normalmente não precisa para onboarding.

3) Policies em public.dias_funcionamento (onboarding)
- Adicionar policy de INSERT/UPDATE/SELECT para onboarding:
  - Usuário sem roles
  - E existe saloes s onde s.id = dias_funcionamento.salao_id
  - E s.created_by_user_id = auth.uid()
  - E ainda não existe admin para s.id
- Isso permite que /configuracoes consiga criar e salvar horários antes do bootstrap do admin.

4) Função public.can_bootstrap_first_admin(user_id uuid)
- Alterar para: “usuário ainda não é admin em nenhum lugar”.
- Não será mais global.

5) Policy de INSERT em public.user_roles (bootstrap admin)
- Atualizar/ recriar a policy user_roles_insert_bootstrap_first_admin para:
  - user_id = auth.uid()
  - role = 'admin'
  - can_bootstrap_first_admin(auth.uid()) = true
  - salao_id válido
  - salao_id não tem admin ainda
  - (recomendado) saloes.created_by_user_id = auth.uid() para garantir “claim” do próprio salao.

B) Ajustes no React
1) Rotas (src/App.tsx)
- Mover /configuracoes para fora do RoleGate de backoffice, mantendo:
  - <AuthGate> obrigatório
  - <AppLayout> opcional (pode manter, pois sidebar já lida com role null).
- Estrutura sugerida:
  - AuthGate -> AppLayout -> rota /configuracoes (sem RoleGate)
  - E RoleGate continua protegendo as demais rotas do backoffice.

2) Redirecionamento quando role = null
- Ajustar RoleGate (src/auth/RoleGate.tsx) para que:
  - se role for null, o redirect padrão seja /configuracoes (em vez de /).
  - evita loop e direciona o usuário para onboarding imediatamente.

3) Reforço “sem signup de empresa” (src/pages/Auth.tsx)
- Trocar a lógica de allowSignup:
  - em vez de Boolean(location.state.allowSignup),
  - usar uma condição mais forte baseada em portal === "cliente" (setado pelo AuthGate quando vem do portal) e/ou pathname do “from”.
- Resultado:
  - app principal: só login
  - portal cliente: login + criar conta (restrito ao tenant pelo token, como você quer).

4) /configuracoes UX (src/pages/Configuracoes.tsx)
- Ajustar textos do card de RBAC para refletir “primeiro acesso do estabelecimento”.
- (Opcional) Mostrar um bloco “Onboarding” quando myRolesQuery retornar vazio:
  - Explicar os 2 passos: 1) Salvar estabelecimento 2) Definir admin
  - Isso reduz confusão para novos usuários.

Como você vai testar (passo a passo)
1) Criar um usuário de teste (empresa) no Supabase Dashboard (Auth > Users)
- Importante: este passo não é via SQL no Supabase (criar usuário diretamente por SQL não é suportado/encorajado em Supabase, pois auth.users é gerenciado).
2) Fazer login com esse usuário no app
3) Confirmar que ele é enviado para /configuracoes (ou consegue acessar /configuracoes)
4) Preencher nome do estabelecimento e salvar
5) Definir como admin no botão “Definir este usuário como Admin (1ª vez)”
6) Verificar que:
- role passa a ser “admin”
- sidebar passa a exibir o menu completo
- dados e queries ficam isolados por tenant

Observações importantes sobre a sua landing page (produção)
- A landing page deve criar o usuário no Auth via Admin API (service role) e entregar as credenciais de forma controlada (p.ex. e-mail “boas-vindas” ou tela pós-compra).
- Esse frontend (Lovable) continuará com login-only para empresas.
- Para automatizar 100% o onboarding (criar usuário + criar salao + inserir role admin), a forma recomendada é uma Edge Function dedicada (pública porém protegida por chave/assinatura/captcha ou chamada server-to-server pelo seu backend da landing). Isso fica como próximo passo, mas não é obrigatório para destravar o multi-tenant via UI agora.

Riscos/atenções (segurança e consistência)
- Evitar “SELECT de salões órfãos” para usuários sem role: por isso a coluna created_by_user_id e policy baseada nela.
- Garantir que dias_funcionamento no onboarding só possa ser alterado pelo criador do salao e somente antes de existir admin.
- Garantir que após o bootstrap, a administração siga estritamente via RLS de roles (padrão já adotado no projeto).
- Não armazenar roles no frontend (já está correto: roles vêm do banco via AccessProvider).

Entregáveis (o que será mudado quando você aprovar)
- Migração SQL em supabase/migrations/…:
  - ALTER TABLE saloes add created_by_user_id
  - Atualização/criação de RLS policies em saloes e dias_funcionamento
  - Atualização da função can_bootstrap_first_admin
  - Atualização da policy user_roles_insert_bootstrap_first_admin
- Código React:
  - src/App.tsx: liberar /configuracoes para usuários logados sem role
  - src/auth/RoleGate.tsx: redirect role null -> /configuracoes
  - src/pages/Auth.tsx: reforçar que signup só existe para portal do cliente
  - src/pages/Configuracoes.tsx: texto/UX de onboarding

Critério de pronto
- Um novo usuário (sem user_roles) consegue:
  - logar,
  - acessar /configuracoes,
  - salvar seu salao + horários,
  - virar admin do seu próprio salao,
  - e a partir daí acessar o backoffice normalmente, com isolamento multi-tenant garantido pelo RLS.
