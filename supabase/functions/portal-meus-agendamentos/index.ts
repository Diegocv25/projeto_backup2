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

type Body = { token: string; session_token?: string };

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
  if (!token || !sessionToken) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const salaoId = await resolveSalaoId(admin, token);
  if (!salaoId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const portalAccountId = await requirePortalSession(admin, salaoId, sessionToken);
  if (!portalAccountId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { data: cliente } = await admin
    .from("clientes")
    .select("id")
    .eq("salao_id", salaoId)
    .eq("portal_account_id", portalAccountId)
    .limit(1)
    .maybeSingle();
  if (!cliente?.id) {
    return json({ ok: true, agendamentos: [] });
  }
  const clienteId = String(cliente.id);

  const { data: ags, error: agErr } = await admin
    .from("agendamentos")
    .select("id,data_hora_inicio,status,total_valor,total_duracao_minutos,funcionario_id")
    .eq("salao_id", salaoId)
    .eq("cliente_id", clienteId)
    .order("data_hora_inicio", { ascending: false })
    .limit(100);
  if (agErr) {
    console.error("portal-meus-agendamentos agendamentos error", agErr);
    return json({ ok: false, error: "Erro ao carregar agendamentos" }, { status: 400 });
  }

  const funcionarioIds = Array.from(new Set((ags ?? []).map((a: any) => String(a.funcionario_id)).filter(Boolean)));
  const agendamentoIds = (ags ?? []).map((a: any) => String(a.id));

  const [funcRes, itensRes] = await Promise.all([
    funcionarioIds.length
      ? admin
          .from("funcionarios")
          .select("id,nome")
          .in("id", funcionarioIds)
          .eq("salao_id", salaoId)
          .limit(500)
      : Promise.resolve({ data: [], error: null } as any),
    agendamentoIds.length
      ? admin
          .from("agendamento_itens")
          .select("agendamento_id,servico_id")
          .in("agendamento_id", agendamentoIds)
          .limit(1000)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (funcRes.error) console.error("portal-meus-agendamentos funcionarios error", funcRes.error);
  if (itensRes.error) console.error("portal-meus-agendamentos itens error", itensRes.error);

  const funcNameById = new Map<string, string>();
  for (const f of funcRes.data ?? []) funcNameById.set(String(f.id), String(f.nome));

  // pega só o primeiro serviço por agendamento (modelo atual: 1 serviço)
  const firstServicoByAgendamento = new Map<string, string>();
  for (const it of itensRes.data ?? []) {
    const aid = String(it.agendamento_id);
    if (!firstServicoByAgendamento.has(aid) && it.servico_id) firstServicoByAgendamento.set(aid, String(it.servico_id));
  }
  const servicoIds = Array.from(new Set(Array.from(firstServicoByAgendamento.values())));
  const servRes = servicoIds.length
    ? await admin.from("servicos").select("id,nome").in("id", servicoIds).eq("salao_id", salaoId).limit(500)
    : ({ data: [], error: null } as any);
  if (servRes.error) console.error("portal-meus-agendamentos servicos error", servRes.error);
  const servNameById = new Map<string, string>();
  for (const s of servRes.data ?? []) servNameById.set(String(s.id), String(s.nome));

  const out = (ags ?? []).map((a: any) => {
    const aid = String(a.id);
    const sid = firstServicoByAgendamento.get(aid) ?? null;
    return {
      id: aid,
      data_hora_inicio: String(a.data_hora_inicio),
      status: String(a.status),
      total_valor: Number(a.total_valor),
      total_duracao_minutos: Number(a.total_duracao_minutos),
      funcionario_id: String(a.funcionario_id),
      funcionario_nome: funcNameById.get(String(a.funcionario_id)) ?? null,
      servico_nome: sid ? servNameById.get(sid) ?? null : null,
    };
  });

  return json({ ok: true, agendamentos: out });
});
