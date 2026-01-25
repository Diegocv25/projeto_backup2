import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { AppRole } from "@/auth/access-context";
import { useAccess } from "@/auth/access-context";

function defaultRedirect(role: AppRole | null) {
  if (role === "profissional") return "/profissional/agendamentos";
  return "/";
}

export function RoleGate({ allowed }: { allowed: AppRole[] }) {
  const { role, loading } = useAccess();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-muted-foreground">Carregando permissões…</div>
      </div>
    );
  }

  if (!role || !allowed.includes(role)) {
    return <Navigate to={defaultRedirect(role)} replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
