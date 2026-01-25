import { useMemo, useState } from "react";
import { format, startOfMonth } from "date-fns";

import RelatoriosConcluidosPorDiaSemana from "@/pages/relatorios/RelatoriosConcluidosPorDiaSemana";

export default function RelatoriosPage() {
  const hoje = useMemo(() => new Date(), []);

  // Período principal (controla tudo)
  const [inicio, setInicio] = useState(() => format(startOfMonth(hoje), "yyyy-MM-dd"));
  const [fim, setFim] = useState(() => format(hoje, "yyyy-MM-dd"));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">
          Quantidade de serviços concluídos por dia da semana em um período.
        </p>
      </header>

      <RelatoriosConcluidosPorDiaSemana inicio={inicio} fim={fim} onChangeInicio={setInicio} onChangeFim={setFim} />
    </div>
  );
}
