/**
 * Barreira de erro de renderização.
 *
 * Sem ela, qualquer exceção lançada durante o render desmonta a árvore inteira
 * e o usuário fica com a página em branco, sem pista do que aconteceu e sem
 * caminho de volta — foi exatamente o que aconteceu quando a tela de agenda
 * formatava um horário com um campo que a API não devolve.
 *
 * Isto NÃO substitui o tratamento de erro de requisição, que continua por
 * query, em `ErrorState`. Aqui é só a última linha: mostra o que falhou e
 * oferece recarregar.
 */
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
}

interface Estado {
  erro: Error | null;
}

export class LimiteErro extends Component<Props, Estado> {
  state: Estado = { erro: null };

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo): void {
    // Sem serviço de telemetria no projeto: o console é o registro disponível.
    console.error("Falha de renderização:", erro, info.componentStack);
  }

  render(): ReactNode {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    return (
      <div className="bg-background grid min-h-dvh place-items-center px-5 py-10">
        <div
          role="alert"
          className="border-border bg-card w-full max-w-md rounded-lg border px-6 py-6 text-center"
        >
          <AlertTriangle className="text-warning mx-auto size-6" aria-hidden />
          <h1 className="font-display mt-3 text-lg">Esta tela falhou ao abrir</h1>
          <p className="text-muted-foreground mt-2 text-[13px]">
            Nenhum dado foi perdido. Recarregue a página; se repetir, o detalhe abaixo identifica a
            causa.
          </p>
          <p className="text-muted-foreground bg-muted/60 mt-4 overflow-x-auto rounded-md px-3 py-2 text-left font-mono text-[11px]">
            {erro.message}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => this.setState({ erro: null })}>
              Tentar novamente
            </Button>
            <Button size="sm" onClick={() => window.location.reload()}>
              Recarregar
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
