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
  const { data: salao } = await admin
    .from("saloes")
    .select("id")
    .eq("public_booking_token", token)
    .limit(1)
    .maybeSingle();
  if (!salao?.id) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const tokenHash = await sha256Hex(sessionToken);
  await admin
    .from("portal_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .eq("salao_id", String(salao.id));

  return json({ ok: true });
});
