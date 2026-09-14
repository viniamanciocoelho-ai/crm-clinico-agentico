import { useId } from "react";
import { cn } from "@/lib/utils";

const controle =
  "bg-card border-input text-foreground placeholder:text-muted-foreground/70 w-full rounded-md border px-3 text-sm transition-colors focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(controle, "h-9", className)} {...props} />;
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(controle, "min-h-20 py-2 leading-relaxed", className)} {...props} />;
}

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        controle,
        "h-9 appearance-none bg-[length:14px] bg-[right_0.6rem_center] bg-no-repeat pr-8",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%235D6B64%22 stroke-width=%222%22><path d=%22M6 9l6 6 6-6%22/></svg>')]",
        className,
      )}
      {...props}
    />
  );
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // oxlint-disable-next-line label-has-associated-control -- primitiva genérica; htmlFor vem de quem usa
    <label
      className={cn("text-foreground mb-1.5 block text-[13px] font-medium", className)}
      {...props}
    />
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  erro?: string;
  className?: string;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string }) => React.ReactNode;
}

/** Rótulo + controle + hint/erro amarrados por aria-describedby. */
function Field({ label, hint, erro, className, children }: FieldProps) {
  const id = useId();
  const apoioId = erro || hint ? `${id}-apoio` : undefined;
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-invalid": Boolean(erro), "aria-describedby": apoioId })}
      {(erro || hint) && (
        <p
          id={apoioId}
          className={cn("mt-1.5 text-[12px]", erro ? "text-destructive font-medium" : "text-muted-foreground")}
        >
          {erro ?? hint}
        </p>
      )}
    </div>
  );
}

export { Input, Textarea, Select, Label, Field };
