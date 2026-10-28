import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Pin the root so a lockfile in a parent directory isn't mistaken for the workspace.
  turbopack: { root: import.meta.dirname },
  // Next 16 blocks dev assets (HMR) for hosts other than localhost; allow the
  // loopback IP plus any extra hostnames listed in DEV_ORIGINS.
  allowedDevOrigins: [
    "127.0.0.1",
    ...(process.env.DEV_ORIGINS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  ],
};

export default nextConfig;
