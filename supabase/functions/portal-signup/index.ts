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

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function b64url(bytes: Uint8Array) {
  return b64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hashPassword(password: string) {
  // PBKDF2-SHA256 (compatível com WebCrypto)
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 210_000;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  const hash = new Uint8Array(bits);
  return `pbkdf2_sha256$${iterations}$${b64url(salt)}$${b64url(hash)}`;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64url(bytes);
}

type Body = {
  token: string;
  email: string;
  password: string;
  nome?: string;
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
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const nome = String(body.nome ?? "").trim().slice(0, 120) || null;

  if (!token) return json({ ok: false, error: "Link inválido" }, { status: 400 });
  if (!email || !validateEmail(email)) return json({ ok: false, error: "Email inválido" }, { status: 400 });
  if (password.length < 8 || password.length > 72) return json({ ok: false, error: "Senha inválida" }, { status: 400 });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // resolve salao_id via token
  const { data: salao, error: salaoErr } = await admin
    .from("saloes")
    .select("id")
    .eq("public_booking_token", token)
    .limit(1)
    .maybeSingle();
  if (salaoErr || !salao?.id) return json({ ok: false, error: "Link inválido" }, { status: 400 });
  const salaoId = String(salao.id);

  // criar conta
  const password_hash = await hashPassword(password);
  const { data: created, error: createErr } = await admin
    .from("portal_accounts")
    .insert({ salao_id: salaoId, email, password_hash, nome })
    .select("id")
    .maybeSingle();

  if (createErr) {
    const msg = String(createErr.message ?? "");
    if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
      return json({ ok: false, error: "Este email já possui conta neste estabelecimento." }, { status: 409 });
    }
    return json({ ok: false, error: msg }, { status: 400 });
  }

  const portalAccountId = String(created?.id ?? "");
  if (!portalAccountId) return json({ ok: false, error: "Falha ao criar conta" }, { status: 500 });

  // cria sessão
  const sessionToken = randomToken();
  const tokenHash = await sha256Hex(sessionToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(); // 30 dias

  const { error: sesErr } = await admin.from("portal_sessions").insert({
    salao_id: salaoId,
    portal_account_id: portalAccountId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  if (sesErr) return json({ ok: false, error: sesErr.message }, { status: 400 });

  return json({ ok: true, salao_id: salaoId, portal_account_id: portalAccountId, session_token: sessionToken });
});
