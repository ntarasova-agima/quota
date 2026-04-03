import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["*.loca.lt", "*.lhr.life"],
};

export default nextConfig;
