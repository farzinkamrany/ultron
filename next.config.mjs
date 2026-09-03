import { withSentryConfig } from "@sentry/nextjs";
/** @type {import('next').NextConfig} */

// Bootstrap the undici global proxy so Next.js's native fetch goes through it.
// This is the only reliable method for Next.js 14 (undici-based fetch).
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    console.log(`[Proxy] Global dispatcher set to: ${proxyUrl}`);
  } catch (e) {
    console.warn("[Proxy] Failed to set global dispatcher:", e.message);
  }
}

const nextConfig = {
  // ts-morph uses dynamic requires internally — tell Next.js to keep it as a
  // native Node.js module and never let webpack try to bundle it.
  serverExternalPackages: ["ts-morph", "typescript"],
};

export default withSentryConfig(
  nextConfig,
  {
    silent: true,
    org: "ultron",
    project: "ultron-ai",
  },
  {
    widenClientFileUpload: true,
    transpileClientSDK: true,
    hideSourceMaps: true,
    disableLogger: true,
  }
);
