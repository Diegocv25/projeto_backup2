
Objetivo (comportamento desejado)
- O login (email/senha) apenas autentica a pessoa (conta global do Supabase Auth).
- Cada estabelecimento (salao_id) é independente:
  - O cliente só “existe” para aquele salão depois de completar o cadastro em `public.clientes` para aquele `salao_id`.
  - Agendamentos e dados do portal devem depender desse cadastro no salão atual.
- Não herdar/vincular automaticamente dados de outro salão.
- Se existir um pré-cadastro no salão com o mesmo email, o portal deve pedir confirmação antes de vincular.

Diagnóstico do problema atual
- As políticas RLS para customer em `clientes`, `agendamentos` e `agendamento_itens` exigem `salao_id = current_salao_id()`.
- `current_salao_id()` pega o primeiro `salao_id` do usuário (order by created_at asc). Se o cliente já tem role/cadastro no Salão A, ao tentar se cadastrar no Salão B:
  - o INSERT em `clientes` usa `salao_id = B`
  - a policy exige `salao_id = current_salao_id() = A`
  - resultado: “new row violates row-level security policy for table clientes”.
- No frontend do portal:
  - Há auto-vínculo por email em `ClientePortalApp.tsx` (chama `portal_link_cliente_by_email` automaticamente).
  - As páginas de serviços/agendamento buscam `servicos` sem filtrar por `salao_id` (dependem apenas de RLS). Isso pode causar comportamento confuso quando customer tiver acesso a mais de um salão.

Decisões confirmadas (do que você aprovou)
- Vínculo por email: “Confirmar antes de vincular”.
- Acesso sem cadastro: “Ver antes, agendar depois”.
- Backoffice: “Bloquear backoffice” para role `customer`.

Solução proposta (backend/RLS) — tornar customer “multi-salão” sem travar no primeiro tenant
1) Criar função auxiliar no banco (SECURITY DEFINER)
- Nova função: `public.has_customer_access(_salao_id uuid) returns boolean`
- Lógica: retorna `exists` em `public.user_roles` onde:
  - `user_id = auth.uid()`
  - `role = 'customer'`
  - `salao_id = _salao_id`
- Motivo: trocar a dependência de `current_salao_id()` por um check do tenant da própria linha (row-based), permitindo o mesmo usuário ser cliente em múltiplos salões, sem “travamento”.

2) Atualizar políticas RLS (customer) para não depender de `current_salao_id()`
- `public.clientes`
  - Ajustar policies customer (select/insert/update) para usar:
    - `has_role(auth.uid(), 'customer')`
    - `auth_user_id = auth.uid()`
    - `public.has_customer_access(clientes.salao_id)`
- `public.agendamentos`
  - Ajustar policies customer (select/insert/update/delete) para:
    - `public.has_customer_access(agendamentos.salao_id)`
    - e garantir “dono” via join com `clientes` (auth_user_id = auth.uid())
- `public.agendamento_itens`
  - Ajustar policy customer para:
    - validar ownership via join `agendamentos -> clientes`
    - exigir `public.has_customer_access(a.salao_id)` (onde `a` é o agendamento do item)
- `public.servicos` (SELECT)
  - Ajustar o caso de customer na policy de SELECT para permitir leitura quando:
    - `public.has_customer_access(servicos.salao_id)`
  - Mantém regras existentes para admin/staff/gerente/recepcionista/profissional.

Observação de segurança
- Isso não “mistura” dados entre salões: a linha sempre tem `salao_id`, e a policy exige o role customer naquele `salao_id`.
- O usuário continuará precisando do cadastro em `clientes` daquele salão para agendar, porque as policies de `agendamentos` exigem o vínculo com `clientes`.

Solução proposta (backend/RPC) — “confirmar antes de vincular” pré-cadastro por email
3) Criar uma RPC apenas de “consulta” do possível pré-cadastro
- Nova função: `public.portal_find_cliente_by_email(_salao_id uuid, _email text)`
  - SECURITY DEFINER
  - Retorna algo mínimo (ex.: `id`, `nome`), somente se:
    - existir cliente no salão com `lower(email)=lower(_email)`
    - `auth_user_id is null` (ainda não vinculado)
- Mantemos a RPC existente `portal_link_cliente_by_email` para executar o vínculo após confirmação.

Solução proposta (frontend) — portal consistente por salão e sem vínculo automático
4) Portal: remover vínculo automático e adicionar tela de confirmação
- Em `src/pages/ClientePortalApp.tsx`:
  - Remover o `useEffect` que chama `portal_link_cliente_by_email` automaticamente.
  - Adicionar um “estado” de detecção:
    - ao carregar o salão + user.email + quando não existir `clientes` vinculado (`clienteQuery.data == null`),
    - chamar `portal_find_cliente_by_email` e, se retornar algo, mostrar um Card:
      - “Encontramos um cadastro neste salão com seu email. Deseja vincular?”
      - Botões: “Vincular” (chama `portal_link_cliente_by_email`) e “Não vincular” (segue para o formulário de novo cadastro).
  - Importante: não logar dados sensíveis em console.

5) Portal: filtrar sempre por `salao_id` do token nas queries de lista
- Em `src/pages/ClientePortalServicos.tsx` e `src/pages/ClientePortalAgendamentoForm.tsx`:
  - Ajustar query de `servicos` para incluir `.eq("salao_id", salaoQuery.data!.id)` além de `ativo=true`.
  - Isso evita “misturar serviços” quando o usuário tiver customer role em mais de um salão.

6) “Ver antes, agendar depois”
- Manter o bloqueio já existente do agendamento quando `clienteQuery.data` não existir (isso já cumpre “agendar depois”).
- Serviços continuam visíveis após login mesmo sem cadastro em `clientes` daquele salão.

Backoffice: bloquear `customer` (evitar loop e acesso indevido)
7) Ajustar o redirecionamento padrão para role `customer`
- Hoje `RoleGate.defaultRedirect(role)` devolve “/” para qualquer role diferente de profissional e null.
- Para `customer`, isso pode causar redirect loop ou cair em área indevida.
- Ajuste planejado:
  - Se `role === "customer"`: redirecionar para uma rota segura (ex.: `/auth` ou `/cliente/:token` quando houver token).
  - Como o backoffice não tem token, a opção mais robusta é `/auth` com uma mensagem (“Acesso do cliente é pelo link do salão.”).
- Alternativa (opcional): criar um “CustomerBackofficeBlock” envolvendo o AppLayout que, se role customer, faz redirect para `/auth`.

Sequência de implementação (quando você aprovar a execução)
1) Migration (SQL) com:
   - `create or replace function public.has_customer_access(_salao_id uuid) ... security definer`
   - `create or replace function public.portal_find_cliente_by_email(...) ... security definer`
   - Alterações nas policies de:
     - `clientes` (customer insert/select/update)
     - `agendamentos` (customer select/insert/update/delete)
     - `agendamento_itens` (customer policy)
     - `servicos` (select para customer)
2) Frontend:
   - `ClientePortalApp.tsx`: confirmação antes de vincular, removendo auto-link.
   - `ClientePortalServicos.tsx` e `ClientePortalAgendamentoForm.tsx`: filtrar `servicos` por `salao_id`.
   - `RoleGate.tsx` (ou gate equivalente): bloquear customer do backoffice com redirect seguro.
3) Testes manuais (cenários mínimos)
- Cenário A: Cliente já cadastrado no Salão A entra no link do Salão B
  - Faz login
  - Consegue ver serviços do Salão B
  - Tenta agendar -> pede cadastro
  - Faz cadastro -> NÃO dá erro de RLS
  - Depois consegue criar agendamento no Salão B
- Cenário B: Salão B tinha pré-cadastro por email
  - Cliente faz login
  - Portal mostra confirmação “vincular?”
  - Se “vincular”: cadastro aparece sem preencher formulário
  - Se “não vincular”: segue fluxo de novo cadastro (e o pré-cadastro continua não vinculado)
- Cenário C: Cliente tenta acessar backoffice (ex.: “/”)
  - É redirecionado para `/auth` (ou outra rota segura) sem loop.

Riscos e mitigação
- Risco: tornar customer “multi-salão” pode aumentar a superfície de acesso, se houver query sem filtro por salao_id.
  - Mitigação: filtrar explicitamente por salao_id nas telas do portal (principalmente `servicos`) e manter RLS por `salao_id`.
- Risco: alterações de policy podem afetar usuários existentes.
  - Mitigação: políticas novas mantêm as mesmas restrições de ownership, apenas removem a dependência de `current_salao_id()` para customer.

Entregável final
- Cliente com login global consegue entrar em qualquer portal, mas só consegue agendar e ver “seus dados” após se cadastrar como cliente naquele salão.
- Cadastro em um salão não é herdado por outro.
- Pré-cadastro por email só é vinculado após confirmação explícita do usuário.
- Role customer bloqueado do backoffice.
