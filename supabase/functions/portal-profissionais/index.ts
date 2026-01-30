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

type Body = { token: string; session_token?: string; servico_id: string };

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
  const servicoId = String(body.servico_id ?? "").trim();
  const sessionToken = String(req.headers.get("x-portal-session") ?? body.session_token ?? "").trim();
  if (!token || !sessionToken || !servicoId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const salaoId = await resolveSalaoId(admin, token);
  if (!salaoId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const portalAccountId = await requirePortalSession(admin, salaoId, sessionToken);
  if (!portalAccountId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { data: links, error: linkErr } = await admin
    .from("servicos_funcionarios")
    .select("funcionario_id")
    .eq("servico_id", servicoId)
    .limit(500);
  if (linkErr) {
    console.error("portal-profissionais links error", linkErr);
    return json({ ok: false, error: "Erro ao carregar profissionais" }, { status: 400 });
  }

  const ids = Array.from(new Set((links ?? []).map((l: any) => String(l.funcionario_id)).filter(Boolean)));
  if (ids.length === 0) return json({ ok: true, salao_id: salaoId, portal_account_id: portalAccountId, profissionais: [] });

  const { data: profs, error: profErr } = await admin
    .from("funcionarios")
    .select("id,nome,carga,ativo,salao_id")
    .in("id", ids)
    .eq("salao_id", salaoId)
    .eq("ativo", true)
    .order("nome", { ascending: true })
    .limit(500);
  if (profErr) {
    console.error("portal-profissionais funcionarios error", profErr);
    return json({ ok: false, error: "Erro ao carregar profissionais" }, { status: 400 });
  }

  const profissionais = (profs ?? [])
    .filter((p: any) => String(p.carga ?? "profissional") === "profissional")
    .map((p: any) => ({ id: String(p.id), nome: String(p.nome) }));

  return json({ ok: true, salao_id: salaoId, portal_account_id: portalAccountId, profissionais });
});
