import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { isAllowedSignInEmail, normalizeEmail } from "../src/lib/authRules";

const EMAIL_SEND_ERROR =
  "Не удалось отправить код: почтовый сервер временно недоступен. Попробуйте позже или напишите администратору.";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Email({
      sendVerificationRequest: async ({ identifier, token }) => {
        const normalizedIdentifier = normalizeEmail(identifier);
        if (!isAllowedSignInEmail(normalizedIdentifier)) {
          throw new Error("Войти в Aurum можно только с почтой @agima.ru");
        }
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
            text: [
              "Код для входа в Aurum:",
              token,
              "",
              "Скопируйте код и вставьте его на странице входа.",
              "Если кодов пришло несколько, используйте самый новый.",
            ].join("\n"),
            html: `
              <p>Код для входа в Aurum:</p>
              <p style="font-size: 24px; line-height: 1.3;"><strong>${token}</strong></p>
              <p>Скопируйте код и вставьте его на странице входа.</p>
              <p>Если кодов пришло несколько, используйте самый новый.</p>
            `,
          }),
        });
        if (!response.ok) {
          throw new Error(EMAIL_SEND_ERROR);
        }
      },
    }),
  ],
});
