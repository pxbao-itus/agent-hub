import { CopyButton } from "./copy-button";

type Props = {
  children: string;
  className?: string;
};

export function CodeBlock({ children, className }: Props) {
  return (
    <div className={`relative rounded-lg border bg-muted/40 ${className ?? ""}`}>
      <div className="absolute right-2 top-2">
        <CopyButton text={children} />
      </div>
      <pre className="overflow-x-auto p-4 pr-10 font-mono text-sm whitespace-pre-wrap leading-relaxed">
        {children}
      </pre>
    </div>
  );
}
