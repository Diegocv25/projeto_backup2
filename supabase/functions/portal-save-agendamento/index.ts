// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-portal-session",
};

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders, ...(init.headers ?? {}) },
    ...init,
  });
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function resolveSalaoId(admin: any, token: string) {
  const { data } = await admin
    .from("saloes")
    .select("id")
    .eq("public_booking_token", token)
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

async function requirePortalSession(admin: any, salaoId: string, sessionToken: string) {
  const tokenHash = await sha256Hex(sessionToken);
  const { data: sess } = await admin
    .from("portal_sessions")
    .select("portal_account_id,expires_at,revoked_at")
    .eq("token_hash", tokenHash)
    .eq("salao_id", salaoId)
    .limit(1)
    .maybeSingle();
  if (!sess?.portal_account_id) return null;
  if (sess.revoked_at) return null;
  if (new Date(String(sess.expires_at)).getTime() < Date.now()) return null;
  return String(sess.portal_account_id);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

type Body = {
  token: string;
  session_token?: string;
  agendamento_id?: string | null;
  servico_id: string;
  funcionario_id: string;
  data_hora_inicio: string;
  duracao_minutos: number;
  valor: number;
  observacoes?: string | null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, { status: 405 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Missing env" }, { status: 500 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const token = String(body.token ?? "").trim();
  const sessionToken = String(req.headers.get("x-portal-session") ?? body.session_token ?? "").trim();
  const agendamentoId = body.agendamento_id ? String(body.agendamento_id) : null;
  const servicoId = String(body.servico_id ?? "").trim();
  const funcionarioId = String(body.funcionario_id ?? "").trim();
  const inicioIso = String(body.data_hora_inicio ?? "").trim();
  const duracao = Number(body.duracao_minutos ?? 0);
  const valor = Number(body.valor ?? 0);
  const observacoes = body.observacoes == null ? null : String(body.observacoes).trim().slice(0, 800);

  if (!token || !sessionToken) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!servicoId || !funcionarioId) return json({ ok: false, error: "Dados inválidos" }, { status: 400 });
  if (!Number.isFinite(duracao) || duracao <= 0 || duracao > 24 * 60) return json({ ok: false, error: "Dados inválidos" }, { status: 400 });
  if (!Number.isFinite(valor) || valor < 0) return json({ ok: false, error: "Dados inválidos" }, { status: 400 });

  const inicio = new Date(inicioIso);
  if (!Number.isFinite(inicio.getTime())) return json({ ok: false, error: "Data inválida" }, { status: 400 });
  const fim = new Date(inicio.getTime() + duracao * 60 * 1000);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const salaoId = await resolveSalaoId(admin, token);
  if (!salaoId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const portalAccountId = await requirePortalSession(admin, salaoId, sessionToken);
  if (!portalAccountId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // exige cadastro do cliente no salão para criar/editar agendamento
  const { data: cliente } = await admin
    .from("clientes")
    .select("id")
    .eq("salao_id", salaoId)
    .eq("portal_account_id", portalAccountId)
    .limit(1)
    .maybeSingle();
  if (!cliente?.id) return json({ ok: false, error: "Finalize seu cadastro antes de agendar." }, { status: 403 });
  const clienteId = String(cliente.id);

  // valida se servico e funcionario pertencem ao salão e estão ativos
  const [{ data: serv }, { data: func }] = await Promise.all([
    admin.from("servicos").select("id,ativo,salao_id").eq("id", servicoId).eq("salao_id", salaoId).limit(1).maybeSingle(),
    admin.from("funcionarios").select("id,ativo,salao_id").eq("id", funcionarioId).eq("salao_id", salaoId).limit(1).maybeSingle(),
  ]);
  if (!serv?.id || !serv.ativo) return json({ ok: false, error: "Serviço indisponível" }, { status: 400 });
  if (!func?.id || !func.ativo) return json({ ok: false, error: "Profissional indisponível" }, { status: 400 });

  // conflito (server-side) para reduzir risco caso trigger não exista
  // busca agendamentos do dia do profissional e checa overlap
  const dayStart = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), inicio.getUTCDate(), 0, 0, 0));
  const dayNext = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const { data: busy, error: busyErr } = await admin
    .from("agendamentos")
    .select("id,data_hora_inicio,total_duracao_minutos,status")
    .eq("salao_id", salaoId)
    .eq("funcionario_id", funcionarioId)
    .neq("status", "cancelado")
    .gte("data_hora_inicio", dayStart.toISOString())
    .lt("data_hora_inicio", dayNext.toISOString())
    .limit(500);
  if (busyErr) {
    console.error("portal-save-agendamento busy error", busyErr);
    return json({ ok: false, error: "Erro ao validar disponibilidade" }, { status: 400 });
  }
  for (const b of busy ?? []) {
    const bid = String(b.id);
    if (agendamentoId && bid === agendamentoId) continue;
    const bStart = new Date(String(b.data_hora_inicio)).getTime();
    const bEnd = bStart + Number(b.total_duracao_minutos) * 60 * 1000;
    if (overlaps(inicio.getTime(), fim.getTime(), bStart, bEnd)) {
      return json({ ok: false, error: "Este horário já está ocupado." }, { status: 409 });
    }
  }

  if (agendamentoId) {
    // update: garante ownership
    const { data: existing } = await admin
      .from("agendamentos")
      .select("id,status")
      .eq("id", agendamentoId)
      .eq("salao_id", salaoId)
      .eq("cliente_id", clienteId)
      .limit(1)
      .maybeSingle();
    if (!existing?.id) return json({ ok: false, error: "Not found" }, { status: 404 });
    const st = String(existing.status);
    if (st === "cancelado" || st === "concluido") return json({ ok: false, error: "Este agendamento não pode ser alterado." }, { status: 409 });

    const { error: updErr } = await admin
      .from("agendamentos")
      .update({ funcionario_id: funcionarioId, data_hora_inicio: inicio.toISOString(), total_duracao_minutos: duracao, total_valor: valor, observacoes })
      .eq("id", agendamentoId);
    if (updErr) {
      console.error("portal-save-agendamento update error", updErr);
      return json({ ok: false, error: "Erro ao salvar" }, { status: 400 });
    }

    // simplificação: 1 item → reescreve
    await admin.from("agendamento_itens").delete().eq("agendamento_id", agendamentoId);
    const { error: itErr } = await admin
      .from("agendamento_itens")
      .insert({ agendamento_id: agendamentoId, servico_id: servicoId, duracao_minutos: duracao, valor });
    if (itErr) {
      console.error("portal-save-agendamento itens update error", itErr);
      return json({ ok: false, error: "Erro ao salvar" }, { status: 400 });
    }

    return json({ ok: true, agendamento_id: agendamentoId });
  }

  // create
  const { data: created, error: insErr } = await admin
    .from("agendamentos")
    .insert({
      salao_id: salaoId,
      cliente_id: clienteId,
      funcionario_id: funcionarioId,
      data_hora_inicio: inicio.toISOString(),
      total_duracao_minutos: duracao,
      total_valor: valor,
      observacoes,
      status: "marcado",
    })
    .select("id")
    .maybeSingle();
  if (insErr) {
    console.error("portal-save-agendamento insert error", insErr);
    return json({ ok: false, error: "Erro ao salvar" }, { status: 400 });
  }
  const newId = String(created?.id ?? "");
  if (!newId) return json({ ok: false, error: "Erro ao salvar" }, { status: 400 });

  const { error: itErr } = await admin
    .from("agendamento_itens")
    .insert({ agendamento_id: newId, servico_id: servicoId, duracao_minutos: duracao, valor });
  if (itErr) {
    console.error("portal-save-agendamento itens insert error", itErr);
    // tenta limpar o agendamento criado para não deixar lixo
    await admin.from("agendamentos").delete().eq("id", newId);
    return json({ ok: false, error: "Erro ao salvar" }, { status: 400 });
  }

  return json({ ok: true, agendamento_id: newId });
});
