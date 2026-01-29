import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";

import { usePortalSalaoByToken } from "@/hooks/usePortalSalaoByToken";
import { getPortalSession, clearPortalSession } from "@/portal/portal-session";
import { portalWhoami } from "@/portal/portal-api";

export function PortalGate() {
  const location = useLocation();
  const { token } = useParams();
  const tokenValue = typeof token === "string" ? token.trim() : "";

  const salaoQuery = usePortalSalaoByToken(tokenValue);

  const whoamiQuery = useQuery({
    queryKey: ["portal-whoami", salaoQuery.data?.id],
    enabled: !!salaoQuery.data?.id,
    queryFn: async () => {
      const salaoId = salaoQuery.data!.id;
      const session = getPortalSession(salaoId);
      if (!session?.sessionToken) return { ok: false as const, error: "not_logged" };

      const res = await portalWhoami({ token: tokenValue, session_token: session.sessionToken });
      if (!res.ok) {
        clearPortalSession(salaoId);
      }
      return res;
    },
    retry: false,
  });

  if (!tokenValue) {
    return <Navigate to="/cliente/" replace />;
  }

  if (salaoQuery.isLoading || whoamiQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Carregando portal…</div>
      </div>
    );
  }

  if (salaoQuery.isError || !salaoQuery.data) {
    return <Navigate to={`/cliente/${tokenValue}`} replace state={{ from: location.pathname }} />;
  }

  if (!whoamiQuery.data || !whoamiQuery.data.ok) {
    // Sempre tratar como primeiro acesso neste estabelecimento
    return <Navigate to={`/cliente/${tokenValue}`} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
