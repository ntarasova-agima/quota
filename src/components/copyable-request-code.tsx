"use client";

import { useState } from "react";
import type { MouseEvent } from "react";
import { HoverHint } from "@/components/ui/hover-hint";
import { cn } from "@/lib/utils";

type CopyableRequestCodeProps = {
  code: string;
  className?: string;
};

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export default function CopyableRequestCode({
  code,
  className,
}: CopyableRequestCodeProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    await copyTextToClipboard(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <HoverHint
      label={copied ? "Скопировано" : "Копировать номер"}
      className={cn("align-baseline", className)}
    >
      <button
        type="button"
        onClick={handleCopy}
        className="rounded-sm text-inherit underline-offset-4 transition-colors hover:text-emerald-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
        aria-label={`Скопировать номер заявки ${code}`}
      >
        {code}
      </button>
    </HoverHint>
  );
}
