import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isAgimaEmail(email: string) {
  return /^[^@\s]+@agima\.ru$/i.test(email.trim());
}

function isAllowedSignInEmail(email: string) {
  return (
    isAgimaEmail(email) ||
    (process.env.NODE_ENV !== "production" && /^[^@\s]+@quota\.local$/i.test(email.trim()))
  );
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Email({
      sendVerificationRequest: async ({ identifier, token }) => {
        const normalizedIdentifier = normalizeEmail(identifier);
        if (!isAllowedSignInEmail(normalizedIdentifier)) {
          throw new Error("Войти в Aurum можно только с почтой @agima.ru");
        }
        const baseUrl = (process.env.EMAIL_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
        const encodedCode = encodeURIComponent(token);
        const encodedEmail = encodeURIComponent(normalizedIdentifier);
        const safeUrl = `${baseUrl}/sign-in?email=${encodedEmail}&code=${encodedCode}#code=${encodedCode}&email=${encodedEmail}`;
        const emailApiBaseUrl = process.env.EMAIL_API_BASE_URL ?? process.env.EMAIL_BASE_URL ?? "http://localhost:3000";
        const response = await fetch(`${emailApiBaseUrl.replace(/\/+$/, "")}/api/email/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-email-api-key": process.env.EMAIL_API_KEY ?? "dev-email-key",
          },
          body: JSON.stringify({
            to: [normalizedIdentifier],
            subject: "Код для входа в Aurum",
            html: `
              <p>Код для входа в Aurum:</p>
              <p><strong>${token}</strong></p>
              <p>Или перейдите по ссылке:</p>
              <p><a href="${safeUrl}">${safeUrl}</a></p>
            `,
          }),
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`SMTP error: ${errorText}`);
        }
      },
    }),
  ],
});
