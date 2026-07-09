import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { db } from "../db";
import { sendEmail } from "./email";
import { loadAuthEnv } from "../config/env";
import { emailOTP, admin } from "better-auth/plugins"

const env = loadAuthEnv();

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
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
    sendResetPassword: async ({ user, url, token }, request) => {
      void sendEmail({
        to: user.email,
        subject: "Reset your password",
        text: `Click the link to reset your password: ${url}`,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url, token }, request) => {
      void sendEmail({
        to: user.email,
        subject: "Verify your email address",
        text: `Click the link to verify your email: ${url}`,
      });
    },
  },
  plugins: [
    admin({

    }),
    emailOTP({
              async sendVerificationOTP({ email, otp, type }) {
                  if (type === "sign-in") {
                      // Send the OTP for sign in
                      void sendEmail({
                          to: email,
                          subject: "Sign in OTP",
                          text: `Your OTP is: ${otp}`,
                      });
                  } else if (type === "email-verification") {
                      // Send the OTP for email verification
                      void sendEmail({
                          to: email,
                          subject: "Email verification OTP",
                          text: `Your OTP is: ${otp}`,
                      });
                  } else {
                      // Send the OTP for password reset
                      void sendEmail({
                          to: email,
                          subject: "Password reset OTP",
                          text: `Your OTP is: ${otp}`,
                      });
                  }
              },
          })
  ],
  socialProviders: {
    google: {
      clientId: env.google.clientId,
      clientSecret: env.google.clientSecret,
    },
  },
});
