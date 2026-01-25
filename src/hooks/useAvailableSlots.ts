 import { useQuery } from "@tanstack/react-query";
 import { addDays, format, getDay, startOfDay } from "date-fns";
 import { supabase } from "@/integrations/supabase/client";
 import { buildAvailableSlots } from "@/lib/scheduling";
 
 type UseAvailableSlotsParams = {
   funcionarioId: string | null;
   data: string | null;
   serviceDurationMinutes: number | null;
  salaoId?: string | null; // Necessário para verificar dias de funcionamento
   excludeAgendamentoId?: string | null; // Em edição, excluir o próprio agendamento
   usePortalRpc?: boolean; // Se true, usa RPC security definer para portal
 };
 
 /**
  * Hook unificado para buscar slots disponíveis.
  * Usado tanto no sistema de gestão quanto no portal do cliente.
  * Garante que a lógica de cálculo de horários disponíveis é idêntica em ambos:
  * 
  * 1. Verifica se o SALÃO está aberto naquele dia da semana (dias_funcionamento)
  * 2. Verifica se o FUNCIONÁRIO trabalha naquele dia (horarios_funcionario)
  * 3. Busca agendamentos já ocupados (exceto cancelados)
  * 4. Calcula slots considerando:
  *    - Horário de trabalho do funcionário
  *    - Intervalo de almoço
  *    - Duração do serviço
  *    - Horários já ocupados
  *    - Slots de 30 em 30 minutos
  */
 export function useAvailableSlots(params: UseAvailableSlotsParams) {
   const { funcionarioId, data, serviceDurationMinutes, salaoId, excludeAgendamentoId, usePortalRpc } = params;
 
   return useQuery({
     queryKey: [
       usePortalRpc ? "portal-slots" : "slots-disponiveis",
       funcionarioId,
       data,
       serviceDurationMinutes,
       salaoId,
       excludeAgendamentoId,
     ],
     enabled: !!funcionarioId && !!data && !!serviceDurationMinutes && !!salaoId,
     queryFn: async () => {
       if (!funcionarioId || !data || !serviceDurationMinutes || !salaoId) return [];
 
       const day = new Date(`${data}T00:00:00`);
       const dow = getDay(day); // 0=domingo, 1=segunda, ..., 6=sábado
 
       // 1. VERIFICAR SE O SALÃO ESTÁ ABERTO NESTE DIA DA SEMANA
       const { data: diaFuncionamento, error: diaErr } = await supabase
         .from("dias_funcionamento")
         .select("fechado,abre_em,fecha_em,intervalo_inicio,intervalo_fim")
         .eq("salao_id", salaoId)
         .eq("dia_semana", dow)
         .maybeSingle();
       if (diaErr) throw diaErr;
 
       // Se o salão está fechado neste dia ou não existe configuração, não há horários disponíveis
       if (!diaFuncionamento || diaFuncionamento.fechado) return [];
 
       // 2. BUSCAR HORÁRIO DE TRABALHO DO FUNCIONÁRIO NO DIA DA SEMANA
       let horario: { inicio: string; fim: string; almoco_inicio: string | null; almoco_fim: string | null } | null = null;
 
       if (usePortalRpc) {
         // Portal: usa RPC SECURITY DEFINER para evitar problemas de RLS
         const sb = supabase as any;
         const { data: horarios, error: horErr } = await sb.rpc("portal_horarios_funcionario_public", {
           _salao_id: salaoId,
           _funcionario_id: funcionarioId,
         });
         if (horErr) throw horErr;
 
         const rows = (horarios ?? []) as any[];
         horario = rows.find((r: any) => Number(r.dia_semana) === dow) ?? null;
       } else {
         // Sistema: query direta com RLS
         const { data: horarioData, error: horErr } = await supabase
           .from("horarios_funcionario")
           .select("inicio,fim,almoco_inicio,almoco_fim")
           .eq("funcionario_id", funcionarioId)
           .eq("dia_semana", dow)
           .maybeSingle();
         if (horErr) throw horErr;
         horario = horarioData;
       }
 
       // Se o funcionário não trabalha neste dia, retorna vazio
       if (!horario) return [];
 
       // 3. BUSCAR AGENDAMENTOS JÁ OCUPADOS NO DIA (exceto cancelados)
       const start = startOfDay(day);
       const next = addDays(start, 1);
 
       const { data: busy, error: busyErr } = await supabase
         .from("agendamentos")
         .select("id,data_hora_inicio,total_duracao_minutos")
         .eq("funcionario_id", funcionarioId)
         .gte("data_hora_inicio", start.toISOString())
         .lt("data_hora_inicio", next.toISOString())
         .neq("status", "cancelado");
       if (busyErr) throw busyErr;
 
       // Mapear agendamentos ocupados para formato { start, durationMinutes }
       let busyMapped = (busy ?? []).map((b: any) => ({
         id: String(b.id),
         start: format(new Date(b.data_hora_inicio), "HH:mm"),
         durationMinutes: Number(b.total_duracao_minutos),
       }));
 
       // Em edição: excluir o próprio agendamento dos horários ocupados (para não bloquear ele mesmo)
       if (excludeAgendamentoId) {
         busyMapped = busyMapped.filter((b) => b.id !== excludeAgendamentoId);
       }
 
       // 4. CALCULAR SLOTS DISPONÍVEIS
       // Usa a lógica centralizada que considera:
       // - Janela de trabalho do funcionário
       // - Intervalo de almoço do funcionário
       // - Duração do serviço (para garantir que cabe no slot)
       // - Horários já ocupados
       // - Incrementos de 30 minutos
       return buildAvailableSlots({
         workStart: String(horario.inicio),
         workEnd: String(horario.fim),
         lunchStart: horario.almoco_inicio ?? null,
         lunchEnd: horario.almoco_fim ?? null,
         slotStepMinutes: 30,
         serviceDurationMinutes: serviceDurationMinutes,
         busy: busyMapped.map((b) => ({ start: b.start, durationMinutes: b.durationMinutes })),
       });
     },
   });
 }