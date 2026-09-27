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

const env = loadAuthEnv();

export const auth = betterAuth({
  basePath: `/api/${apiVersion}/auth`,
  baseURL: env.baseUrl,
  secret: env.secret,
  trustedOrigins: env.trustedOrigins,
  advanced: {
    useSecureCookies: env.secureCookies,
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
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your email address",
        text: `Click the link to verify your email: ${url}`,
      });
    },
  },
  plugins: [
    admin(),
    auditLog(),
    openAPI(),
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        if (type === "sign-in") {
          // Send the OTP for sign in
          await sendEmail({
            to: email,
            subject: "Sign in OTP",
            text: `Your OTP is: ${otp}`,
          });
        } else if (type === "email-verification") {
          // Send the OTP for email verification
          await sendEmail({
            to: email,
            subject: "Email verification OTP",
            text: `Your OTP is: ${otp}`,
          });
        } else {
          // Send the OTP for password reset
          await sendEmail({
            to: email,
            subject: "Password reset OTP",
            text: `Your OTP is: ${otp}`,
          });
        }
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
