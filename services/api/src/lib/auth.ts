import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { admin, emailOTP, openAPI } from "better-auth/plugins";
import { auditLog } from "better-auth-audit-logs";
import { apiVersion } from "../config/const";
import { loadAuthEnv } from "../config/env";
import { db } from "../db";
import {
  authSessionAdditionalFields,
  authUserAdditionalFields,
} from "../db/schemas/auth/auth-fields";
import { sendEmail } from "./email";
import { type Level, log } from "./log";

const env = loadAuthEnv();

export const auth = betterAuth({
  basePath: `/api/${apiVersion}/auth`,
  baseURL: env.baseUrl,
  secret: env.secret,
  trustedOrigins: env.trustedOrigins,
  // Route Better Auth's own messages through the one-line logger (LOG_LEVEL
  // filters them), and hand unexpected errors to Elysia's error hook instead
  // of letting the router print multi-line dumps.
  logger: {
    level: "debug",
    log: (level, message, ...args) => {
      const error = args.find((arg) => arg instanceof Error);
      const extra = args.filter((arg) => arg !== error);
      log[level as Level](`auth ${message.trim()}`, {
        error,
        detail: extra.length ? extra.map(String).join(" ") : undefined,
      });
    },
  },
  onAPIError: { throw: true },
  advanced: {
    useSecureCookies: env.secureCookies,
    defaultCookieAttributes: {
      sameSite: env.cookieSameSite,
      secure: env.secureCookies,
    },
  },
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  user: {
    additionalFields: authUserAdditionalFields,
  },
  session: {
    additionalFields: authSessionAdditionalFields,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
      ...coreFields,
      // Your additional fields
      ...additionalFields,
      // ID must be last to match database output order
      id,
    }),
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your password",
        text: `Click the link to reset your password: ${url}`,
      });
    },
  },
  emailVerification: {
    // Verification uses the 6-digit email code below; verifying it signs the
    // user in so they land straight in onboarding.
    autoSignInAfterVerification: true,
  },
  plugins: [
    admin(),
    auditLog(),
    openAPI(),
    emailOTP({
      overrideDefaultEmailVerification: true,
      sendVerificationOnSignUp: true,
      otpLength: 6,
      expiresIn: 10 * 60,
      allowedAttempts: 5,
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp, type }) {
        const purpose = {
          "sign-in": ["Your Mock Trader sign-in code", "sign in"],
          "email-verification": [
            "Verify your email for Mock Trader",
            "verify your email",
          ],
          "forget-password": [
            "Reset your Mock Trader password",
            "reset your password",
          ],
          "change-email": [
            "Confirm your new Mock Trader email",
            "confirm your new email",
          ],
        }[type];
        await sendEmail({
          to: email,
          subject: `${otp} is your code · ${purpose[0]}`,
          text: `Use ${otp} to ${purpose[1]}. The code expires in 10 minutes.\n\nIf you didn't request it, you can ignore this email.`,
        });
      },
    }),
  ],
  socialProviders: {
    google: {
      clientId: env.google.clientId,
      clientSecret: env.google.clientSecret,
    },
  },
});
