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

function parseHash(stored: string) {
  // pbkdf2_sha256$iters$salt$hash
  const parts = stored.split("$");
  if (parts.length !== 4) return null;
  const [alg, it, salt, hash] = parts;
  if (alg !== "pbkdf2_sha256") return null;
  const iterations = Number(it);
  if (!Number.isFinite(iterations) || iterations < 10_000) return null;
  return { iterations, salt, hash };
}

function b64urlToBytes(s: string) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64s = s.replaceAll("-", "+").replaceAll("_", "/") + pad;
  const bin = atob(b64s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function verifyPassword(password: string, stored: string) {
  const parsed = parseHash(stored);
  if (!parsed) return false;

  const salt = b64urlToBytes(parsed.salt);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: parsed.iterations },
    key,
    256,
  );
  const hash = new Uint8Array(bits);
  const hashB64Url = b64url(hash);
  return hashB64Url === parsed.hash;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64url(bytes);
}

type Body = { token: string; email: string; password: string };

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

  if (!token) return json({ ok: false, error: "Credenciais inválidas" }, { status: 401 });
  if (!email || !validateEmail(email)) return json({ ok: false, error: "Credenciais inválidas" }, { status: 401 });
  if (password.length < 8 || password.length > 72) return json({ ok: false, error: "Credenciais inválidas" }, { status: 401 });

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: salao } = await admin
    .from("saloes")
    .select("id")
    .eq("public_booking_token", token)
    .limit(1)
    .maybeSingle();
  if (!salao?.id) return json({ ok: false, error: "Credenciais inválidas" }, { status: 401 });
  const salaoId = String(salao.id);

  const { data: account } = await admin
    .from("portal_accounts")
    .select("id,password_hash")
    .eq("salao_id", salaoId)
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (!account?.id || !account.password_hash) return json({ ok: false, error: "Credenciais inválidas" }, { status: 401 });

  const ok = await verifyPassword(password, String(account.password_hash));
  if (!ok) return json({ ok: false, error: "Credenciais inválidas" }, { status: 401 });

  const portalAccountId = String(account.id);
  const sessionToken = randomToken();
  const tokenHash = await sha256Hex(sessionToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

  const { error: sesErr } = await admin.from("portal_sessions").insert({
    salao_id: salaoId,
    portal_account_id: portalAccountId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  if (sesErr) return json({ ok: false, error: "Credenciais inválidas" }, { status: 401 });

  return json({ ok: true, salao_id: salaoId, portal_account_id: portalAccountId, session_token: sessionToken });
});
