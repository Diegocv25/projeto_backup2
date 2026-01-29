import { supabase } from "@/integrations/supabase/client";

export type PortalAuthResponse = {
  ok: true;
  salao_id: string;
  portal_account_id: string;
  session_token: string;
};

export type PortalWhoamiResponse =
  | { ok: true; salao_id: string; portal_account_id: string; email: string | null; nome: string | null }
  | { ok: false; error: string };

async function invoke<T>(fn: string, body: unknown, extraHeaders?: Record<string, string>) {
  const { data, error } = await supabase.functions.invoke(fn, {
    body,
    headers: extraHeaders,
  });
  if (error) throw error;
  return data as T;
}

export async function portalSignup(args: { token: string; email: string; password: string; nome?: string }) {
  return await invoke<PortalAuthResponse | { ok: false; error: string }>("portal-signup", args);
}

export async function portalLogin(args: { token: string; email: string; password: string }) {
  return await invoke<PortalAuthResponse | { ok: false; error: string }>("portal-login", args);
}

export async function portalWhoami(args: { token: string; session_token: string }) {
  return await invoke<PortalWhoamiResponse>("portal-whoami", args, {
    "x-portal-session": args.session_token,
  });
}

export async function portalLogout(args: { token: string; session_token: string }) {
  return await invoke<{ ok: true } | { ok: false; error: string }>("portal-logout", args, {
    "x-portal-session": args.session_token,
  });
}

export async function portalUpsertCliente(args: {
  token: string;
  session_token: string;
  nome: string;
  telefone?: string | null;
  email?: string | null;
  data_nascimento?: string | null; // yyyy-mm-dd
}) {
  return await invoke<{ ok: true; cliente_id: string } | { ok: false; error: string }>("portal-upsert-cliente", args, {
    "x-portal-session": args.session_token,
  });
}

export async function portalServicos(args: { token: string; session_token: string }) {
  return await invoke<
    | {
        ok: true;
        servicos: Array<{ id: string; nome: string; duracao_minutos: number; valor: number }>;
      }
    | { ok: false; error: string }
  >("portal-servicos", args, { "x-portal-session": args.session_token });
}

export async function portalProfissionais(args: { token: string; session_token: string; servico_id: string }) {
  return await invoke<
    | { ok: true; profissionais: Array<{ id: string; nome: string }> }
    | { ok: false; error: string }
  >("portal-profissionais", args, { "x-portal-session": args.session_token });
}

export async function portalHorariosFuncionario(args: {
  token?: string;
  salao_id?: string;
  session_token: string;
  funcionario_id: string;
}) {
  return await invoke<
    | {
        ok: true;
        horarios: Array<{ dia_semana: number; inicio: string; fim: string; almoco_inicio: string | null; almoco_fim: string | null }>;
      }
    | { ok: false; error: string }
  >("portal-horarios-funcionario", args, { "x-portal-session": args.session_token });
}

export async function portalAgendamentosOcupados(args: {
  token?: string;
  salao_id?: string;
  session_token: string;
  funcionario_id: string;
  dia: string;
}) {
  return await invoke<
    | { ok: true; busy: Array<{ id: string; data_hora_inicio: string; total_duracao_minutos: number }> }
    | { ok: false; error: string }
  >("portal-agendamentos-ocupados", args, { "x-portal-session": args.session_token });
}

export async function portalMeusAgendamentos(args: { token: string; session_token: string }) {
  return await invoke<
    | {
        ok: true;
        agendamentos: Array<{
          id: string;
          data_hora_inicio: string;
          status: string;
          total_valor: number;
          total_duracao_minutos: number;
          funcionario_id: string;
          funcionario_nome: string | null;
          servico_nome: string | null;
        }>;
      }
    | { ok: false; error: string }
  >("portal-meus-agendamentos", args, { "x-portal-session": args.session_token });
}

export async function portalSaveAgendamento(args: {
  token: string;
  session_token: string;
  agendamento_id?: string | null;
  servico_id: string;
  funcionario_id: string;
  data_hora_inicio: string; // iso
  duracao_minutos: number;
  valor: number;
  observacoes?: string | null;
}) {
  return await invoke<
    | { ok: true; agendamento_id: string }
    | { ok: false; error: string }
  >("portal-save-agendamento", args, { "x-portal-session": args.session_token });
}

export async function portalGetAgendamento(args: { token: string; session_token: string; agendamento_id: string }) {
  return await invoke<
    | {
        ok: true;
        agendamento: {
          id: string;
          funcionario_id: string;
          data_hora_inicio: string;
          observacoes: string | null;
          status: string;
          itens: Array<{ servico_id: string }>;
        };
      }
    | { ok: false; error: string }
  >("portal-get-agendamento", args, { "x-portal-session": args.session_token });
}

export async function portalCancelAgendamento(args: { token: string; session_token: string; agendamento_id: string }) {
  return await invoke<{ ok: true } | { ok: false; error: string }>("portal-cancel-agendamento", args, {
    "x-portal-session": args.session_token,
  });
}
