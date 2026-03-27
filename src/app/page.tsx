import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-12">
        <Card className="w-full">
          <CardHeader className="items-center text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-4">
                <Image
                  src="/aurum-logo.svg"
                  alt="Aurum logo"
                  width={72}
                  height={72}
                />
                <span className="text-4xl font-semibold uppercase tracking-[0.3em] text-amber-500">
                  Aurum
                </span>
              </div>
              <CardTitle className="text-xl font-medium text-muted-foreground">
                AGIMA — сервис согласования затрат и инвестиций
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button asChild>
              <Link href="/requests">Перейти к заявкам</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/sign-in">Войти</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
