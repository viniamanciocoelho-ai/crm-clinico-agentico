import { AlertTriangle, Inbox, Lock, RotateCcw } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  titulo: string;
  descricao?: string;
  icone?: React.ElementType;
  acao?: React.ReactNode;
  className?: string;
}

function EmptyState({ titulo, descricao, icone: Icone = Inbox, acao, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <div className="bg-muted text-muted-foreground border-border mb-4 rounded-full border p-3">
        <Icone className="size-5" aria-hidden />
      </div>
      <p className="text-foreground font-display text-base">{titulo}</p>
      {descricao && (
        <p className="text-muted-foreground mt-1.5 max-w-sm text-[13px]">{descricao}</p>
      )}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

function ErrorState({
  titulo = "Não foi possível carregar",
  descricao,
  onRetry,
  className,
}: {
  titulo?: string;
  descricao?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center px-6 py-14 text-center", className)}
    >
      <div className="bg-destructive-soft text-destructive border-destructive/20 mb-4 rounded-full border p-3">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <p className="text-foreground font-display text-base">{titulo}</p>
      <p className="text-muted-foreground mt-1.5 max-w-sm text-[13px]">
        {descricao ?? "Ocorreu um erro na requisição."}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RotateCcw className="size-3.5" aria-hidden />
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

/**
 * Bloqueio por permissão — o que o perfil atual não alcança. A permissão real
 * exigida é exibida para que o bloqueio seja rastreável até a rota da API.
 */
function DeniedState({
  recurso,
  role,
  permissao,
  className,
}: {
  recurso: string;
  role: string;
  permissao?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-16 text-center", className)}>
      <div className="bg-warning-soft text-warning border-warning/20 mb-4 rounded-full border p-3">
        <Lock className="size-5" aria-hidden />
      </div>
      <p className="text-foreground font-display text-base">Sem acesso a {recurso}</p>
      <p className="text-muted-foreground mt-1.5 max-w-md text-[13px]">
        O perfil <strong className="text-foreground font-semibold">{role}</strong> não tem a
        permissão necessária
        {permissao && (
          <>
            {" "}
            (<code className="tabular">{permissao}</code>)
          </>
        )}
        . O servidor recusaria a requisição da mesma forma.
      </p>
    </div>
  );
}

export { EmptyState, ErrorState, DeniedState };
