import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  // Parent directories contain another pnpm workspace; pin root detection.
  turbopack: { root: __dirname },
};

export default withEve(nextConfig);
