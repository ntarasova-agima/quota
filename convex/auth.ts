import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Email({
      sendVerificationRequest: async ({ identifier, token, url }) => {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
          throw new Error("Missing RESEND_API_KEY");
        }
        const from = process.env.RESEND_FROM ?? "My App <onboarding@resend.dev>";
        const baseUrl = (process.env.EMAIL_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
        const encodedCode = encodeURIComponent(token);
        const encodedEmail = encodeURIComponent(identifier);
        const safeUrl = `${baseUrl}/sign-in?email=${encodedEmail}&code=${encodedCode}#code=${encodedCode}&email=${encodedEmail}`;
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: identifier,
            subject: "Your sign-in code",
            html: `
              <p>Your one-time sign-in code is:</p>
              <p><strong>${token}</strong></p>
              <p>Or click this link to sign in:</p>
              <p><a href="${safeUrl}">${safeUrl}</a></p>
            `,
          }),
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Resend error: ${errorText}`);
        }
      },
    }),
  ],
});
