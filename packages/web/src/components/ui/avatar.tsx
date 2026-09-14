import { iniciais } from "@/lib/formato";
import { cn } from "@/lib/utils";

interface AvatarProps {
  nome: string;
  cor?: string;
  tamanho?: "sm" | "md" | "lg";
  className?: string;
}

const TAMANHO = {
  sm: "size-7 text-[10px]",
  md: "size-9 text-[12px]",
  lg: "size-12 text-[15px]",
};

function Avatar({ nome, cor, tamanho = "md", className }: AvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-wide",
        TAMANHO[tamanho],
        cor ? "text-white" : "bg-secondary text-primary",
        className,
      )}
      style={cor ? { backgroundColor: cor } : undefined}
    >
      {iniciais(nome)}
    </span>
  );
}

export { Avatar };
