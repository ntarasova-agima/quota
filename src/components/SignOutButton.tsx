"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function SignOutButton({ variant = "outline" }: { variant?: "default" | "outline" }) {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  function clearStoredAuthState() {
    if (typeof window === "undefined") {
      return;
    }
    sessionStorage.removeItem("auth_code");
    sessionStorage.removeItem("auth_email");
  }

  function redirectToSignIn() {
    if (typeof window !== "undefined") {
      window.location.replace("/sign-in");
      return;
    }
    router.replace("/sign-in");
  }

  async function handleSignOut() {
    setLoading(true);
    try {
      await signOut();
    } catch (error) {
      console.error("Aurum sign-out failed, falling back to local redirect", error);
    } finally {
      clearStoredAuthState();
      redirectToSignIn();
    }
  }

  return (
    <Button type="button" variant={variant} onClick={handleSignOut} disabled={loading}>
      Выйти
    </Button>
  );
}
