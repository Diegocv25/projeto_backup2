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

type Body = { token?: string; salao_id?: string; session_token?: string; funcionario_id: string };

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
  const salaoIdFromBody = String(body.salao_id ?? "").trim();
  const funcionarioId = String(body.funcionario_id ?? "").trim();
  const sessionToken = String(req.headers.get("x-portal-session") ?? body.session_token ?? "").trim();
  if ((!token && !salaoIdFromBody) || !sessionToken || !funcionarioId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const salaoId = token ? await resolveSalaoId(admin, token) : salaoIdFromBody;
  if (!salaoId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const portalAccountId = await requirePortalSession(admin, salaoId, sessionToken);
  if (!portalAccountId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // Garante que o funcionário pertence ao salão
  const { data: f } = await admin
    .from("funcionarios")
    .select("id")
    .eq("id", funcionarioId)
    .eq("salao_id", salaoId)
    .limit(1)
    .maybeSingle();
  if (!f?.id) return json({ ok: false, error: "Not found" }, { status: 404 });

  const { data: horarios, error } = await admin
    .from("horarios_funcionario")
    .select("dia_semana,inicio,fim,almoco_inicio,almoco_fim")
    .eq("funcionario_id", funcionarioId)
    .order("dia_semana", { ascending: true })
    .limit(50);
  if (error) {
    console.error("portal-horarios-funcionario error", error);
    return json({ ok: false, error: "Erro ao carregar horários" }, { status: 400 });
  }

  return json({ ok: true, salao_id: salaoId, portal_account_id: portalAccountId, horarios: horarios ?? [] });
});
