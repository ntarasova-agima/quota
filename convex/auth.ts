import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Email({
      sendVerificationRequest: async ({ identifier, token }) => {
        const baseUrl = (process.env.EMAIL_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
        const encodedCode = encodeURIComponent(token);
        const encodedEmail = encodeURIComponent(identifier);
        const safeUrl = `${baseUrl}/sign-in?email=${encodedEmail}&code=${encodedCode}#code=${encodedCode}&email=${encodedEmail}`;
        const emailApiBaseUrl = process.env.EMAIL_API_BASE_URL ?? process.env.EMAIL_BASE_URL ?? "http://localhost:3000";
        const response = await fetch(`${emailApiBaseUrl.replace(/\/+$/, "")}/api/email/send`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-email-api-key": process.env.EMAIL_API_KEY ?? "dev-email-key",
          },
          body: JSON.stringify({
            to: [identifier],
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
