"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function SignOutButton({ variant = "outline" }: { variant?: "default" | "outline" }) {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      await signOut();
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("auth_code");
        sessionStorage.removeItem("auth_email");
      }
      router.replace("/sign-in");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant={variant} onClick={handleSignOut} disabled={loading}>
      Выйти
    </Button>
  );
}
