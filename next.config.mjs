/** @type {import('next').NextConfig} */
const nextConfig = {
  // No ESLint config in this MVP; don't block builds on it. TS errors still fail the build.
  eslint: { ignoreDuringBuilds: true },

  // Domain migration: permanently (308) redirect the OLD host pinnavel.com (and
  // www) to app.navolearning.com, preserving path + query. app.navolearning.com
  // requests don't match the host condition, so they serve normally (no loop).
  async redirects() {
    const toNavo = (host) => ({
      source: "/:path*",
      has: [{ type: "host", value: host }],
      destination: "https://app.navolearning.com/:path*",
      permanent: true,
    });
    return [toNavo("pinnavel.com"), toNavo("www.pinnavel.com")];
  },
};

export default nextConfig;
