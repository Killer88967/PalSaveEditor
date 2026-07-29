import type { NextConfig } from "next";

const rustApiUrl = (
  process.env.RUST_API_URL ?? "http://127.0.0.1:47831"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/rust/:path*",
        destination: `${rustApiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
