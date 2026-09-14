import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
  {
    variants: {
      tom: {
        neutro: "border-border-strong bg-muted text-muted-foreground",
        primary: "border-primary/25 bg-primary/10 text-primary",
        accent: "border-accent/30 bg-accent-soft text-accent",
        success: "border-success/25 bg-success-soft text-success",
        warning: "border-warning/25 bg-warning-soft text-warning",
        info: "border-info/25 bg-info-soft text-info",
        destructive: "border-destructive/25 bg-destructive-soft text-destructive",
      },
    },
    defaultVariants: { tom: "neutro" },
  },
);

type Tom = NonNullable<VariantProps<typeof badgeVariants>["tom"]>;

function Badge({
  className,
  tom,
  ponto = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { ponto?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tom }), className)} {...props}>
      {ponto && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {props.children}
    </span>
  );
}

/** Mapas de status → rótulo + tom. Status nunca é comunicado apenas por cor. */
export const STATUS_AGENDAMENTO: Record<string, { rotulo: string; tom: Tom }> = {
  agendado: { rotulo: "Agendado", tom: "info" },
  confirmado: { rotulo: "Confirmado", tom: "success" },
  remarcado: { rotulo: "Remarcado", tom: "warning" },
  cancelado_pelo_cliente: { rotulo: "Cancelado pelo cliente", tom: "destructive" },
  cancelado_pela_clinica: { rotulo: "Cancelado pela clínica", tom: "destructive" },
};

export const STATUS_ATENDIMENTO: Record<string, { rotulo: string; tom: Tom }> = {
  concluido: { rotulo: "Concluído", tom: "success" },
  falta: { rotulo: "Falta", tom: "warning" },
  cancelado: { rotulo: "Cancelado", tom: "destructive" },
  reembolsado: { rotulo: "Reembolsado", tom: "destructive" },
  brinde: { rotulo: "Brinde", tom: "accent" },
};

export const STATUS_PAGAMENTO: Record<string, { rotulo: string; tom: Tom }> = {
  pago: { rotulo: "Pago", tom: "success" },
  pendente: { rotulo: "Pendente", tom: "warning" },
  estornado: { rotulo: "Estornado", tom: "destructive" },
};

export const FORMA_PAGAMENTO: Record<string, string> = {
  pix: "Pix",
  credito: "Crédito",
  debito: "Débito",
  dinheiro: "Dinheiro",
  pacote: "Pacote",
};

export const STATUS_CONVERSA: Record<string, { rotulo: string; tom: Tom }> = {
  com_ia: { rotulo: "Com a IA", tom: "primary" },
  aguardando_humano: { rotulo: "Aguardando humano", tom: "warning" },
  com_humano: { rotulo: "Com humano", tom: "info" },
  encerrada: { rotulo: "Encerrada", tom: "neutro" },
};

export const ORIGEM: Record<string, string> = {
  ia: "IA",
  recepcao: "Recepção",
  gerente: "Gerente",
  profissional: "Profissional",
};

export { Badge, badgeVariants };
export type { Tom };
