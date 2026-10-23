/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // passport ships untranspiled pieces and pulls in node-only wallet libs
  transpilePackages: [
    "@mezo-org/passport",
    "@mezo-org/orangekit",
    "@mezo-org/orangekit-smart-account",
    "@mezo-org/orangekit-contracts",
    "@mezo-org/sign-in-with-wallet",
  ],
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // optional payment code inside the Coinbase wallet SDK, never used by Deed
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core": false,
      "@x402/evm": false,
      "@x402/svm": false,
    };
    return config;
  },
};

export default nextConfig;
