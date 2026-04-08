"use client";

import { ComponentProps } from "react";
import { Label } from "@/components/ui/label";

type FieldLabelProps = ComponentProps<typeof Label> & {
  required?: boolean;
};

export default function FieldLabel({
  children,
  required = false,
  ...props
}: FieldLabelProps) {
  return (
    <Label {...props}>
      <span>{children}</span>
      {required ? <span className="ml-0.5 text-amber-500">*</span> : null}
    </Label>
  );
}
