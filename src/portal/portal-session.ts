type PortalSession = {
  salaoId: string;
  sessionToken: string;
  portalAccountId: string;
};

const keyForSalao = (salaoId: string) => `portal_session:${salaoId}`;

export function getPortalSession(salaoId: string): PortalSession | null {
  try {
    const raw = localStorage.getItem(keyForSalao(salaoId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PortalSession;
    if (!parsed?.salaoId || !parsed?.sessionToken || !parsed?.portalAccountId) return null;
    if (parsed.salaoId !== salaoId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setPortalSession(session: PortalSession) {
  localStorage.setItem(keyForSalao(session.salaoId), JSON.stringify(session));
}

export function clearPortalSession(salaoId: string) {
  localStorage.removeItem(keyForSalao(salaoId));
}
