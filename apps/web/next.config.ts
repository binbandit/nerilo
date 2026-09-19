import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  distDir: process.env.NERILO_NEXT_DIST_DIR ?? ".next",
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  transpilePackages: ["@nerilo/protocol", "@nerilo/theme"],
  devIndicators: false,
};
export default config;
