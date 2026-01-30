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

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type Body = {
  token: string;
  session_token?: string;
  nome: string;
  telefone?: string | null;
  email?: string | null;
  data_nascimento?: string | null; // yyyy-mm-dd
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
  const nome = String(body.nome ?? "").trim();
  const telefone = body.telefone == null ? null : String(body.telefone).trim().slice(0, 40);
  const email = body.email == null ? null : String(body.email).trim().toLowerCase().slice(0, 255);
  const dataNascimento = body.data_nascimento == null ? null : String(body.data_nascimento).trim();

  if (!token || !sessionToken) return json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (nome.length < 2 || nome.length > 120) return json({ ok: false, error: "Nome inválido" }, { status: 400 });
  if (email && !validateEmail(email)) return json({ ok: false, error: "Email inválido" }, { status: 400 });
  if (dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) return json({ ok: false, error: "Data inválida" }, { status: 400 });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const salaoId = await resolveSalaoId(admin, token);
  if (!salaoId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const portalAccountId = await requirePortalSession(admin, salaoId, sessionToken);
  if (!portalAccountId) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // Upsert por (salao_id, portal_account_id)
  const { data: existing, error: exErr } = await admin
    .from("clientes")
    .select("id")
    .eq("salao_id", salaoId)
    .eq("portal_account_id", portalAccountId)
    .limit(1)
    .maybeSingle();
  if (exErr) {
    console.error("portal-upsert-cliente existing error", exErr);
    return json({ ok: false, error: "Erro ao salvar" }, { status: 400 });
  }

  if (existing?.id) {
    const { error: updErr } = await admin
      .from("clientes")
      .update({ nome, telefone, email, data_nascimento: dataNascimento })
      .eq("id", String(existing.id));
    if (updErr) {
      console.error("portal-upsert-cliente update error", updErr);
      return json({ ok: false, error: "Erro ao salvar" }, { status: 400 });
    }
    return json({ ok: true, cliente_id: String(existing.id) });
  }

  const { data: created, error: insErr } = await admin
    .from("clientes")
    .insert({ salao_id: salaoId, portal_account_id: portalAccountId, nome, telefone, email, data_nascimento: dataNascimento })
    .select("id")
    .maybeSingle();
  if (insErr) {
    console.error("portal-upsert-cliente insert error", insErr);
    return json({ ok: false, error: "Erro ao salvar" }, { status: 400 });
  }

  return json({ ok: true, cliente_id: String(created?.id) });
});
