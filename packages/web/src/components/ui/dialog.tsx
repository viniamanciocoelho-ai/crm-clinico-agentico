import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface DialogProps {
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  descricao?: string;
  children?: React.ReactNode;
  rodape?: React.ReactNode;
  largura?: string;
}

/** Elementos que recebem foco por Tab dentro do painel. */
const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal com Esc, clique fora, foco inicial no painel, foco preso enquanto
 * aberto e foco devolvido a quem abriu.
 *
 * O foco preso não é enfeite: o painel não é um portal e a navegação da
 * aplicação continua no DOM atrás dele. Sem isto, Tab sai do formulário e cai
 * na barra lateral, e quem usa teclado ou leitor de tela perde o contexto sem
 * ter fechado nada.
 */
function Dialog({
  aberto,
  onFechar,
  titulo,
  descricao,
  children,
  rodape,
  largura = "max-w-lg",
}: DialogProps) {
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;

    const abriuCom = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onFechar();
        return;
      }
      if (e.key !== "Tab" || !painel.current) return;

      const alvos = [...painel.current.querySelectorAll<HTMLElement>(FOCAVEIS)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (alvos.length === 0) {
        e.preventDefault();
        painel.current.focus();
        return;
      }

      const primeiro = alvos[0];
      const ultimo = alvos[alvos.length - 1];
      const atual = document.activeElement;
      const dentro = painel.current.contains(atual);

      if (e.shiftKey && (atual === primeiro || !dentro)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (atual === ultimo || !dentro)) {
        e.preventDefault();
        primeiro.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    painel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = anterior;
      // Devolve o foco a quem abriu, se o elemento ainda existe na página.
      if (abriuCom?.isConnected) abriuCom.focus();
    };
  }, [aberto, onFechar]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-[#12302A]/45 backdrop-blur-[2px]"
        onClick={onFechar}
        tabIndex={-1}
      />
      <div
        ref={painel}
        // oxlint-disable-next-line prefer-tag-over-role -- overlay próprio; <dialog> nativo não é usado no protótipo
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        className={cn(
          "bg-card border-border rise relative w-full rounded-t-xl border shadow-[0_24px_60px_-20px_rgba(18,48,42,0.45)] outline-none sm:rounded-xl",
          largura,
        )}
      >
        <div className="border-border flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <h2 className="font-display text-base">{titulo}</h2>
            {descricao && <p className="text-muted-foreground mt-1 text-[13px]">{descricao}</p>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onFechar} aria-label="Fechar">
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        {children && <div className="px-5 py-4">{children}</div>}
        {rodape && (
          <div className="border-border bg-muted/40 flex items-center justify-end gap-2 rounded-b-xl border-t px-5 py-3">
            {rodape}
          </div>
        )}
      </div>
    </div>
  );
}

export { Dialog };
