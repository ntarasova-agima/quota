import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type HoverHintProps = {
  label: string;
  children: ReactNode;
  className?: string;
  tooltipClassName?: string;
};

export function HoverHint({
  label,
  children,
  className,
  tooltipClassName,
}: HoverHintProps) {
  return (
    <span className={cn("group/hover-hint relative inline-flex cursor-help", className)}>
      {children}
      <span
        className={cn(
          "pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden max-w-64 -translate-x-1/2 whitespace-normal rounded-md bg-zinc-950 px-2.5 py-1.5 text-xs font-medium leading-5 text-white shadow-[0_10px_30px_rgba(24,24,27,0.28)] group-hover/hover-hint:block",
          tooltipClassName,
        )}
      >
        {label}
      </span>
    </span>
  );
}
