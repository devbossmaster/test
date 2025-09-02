// next.config.js
const nextConfig = {
  webpack: (config: { externals: string[]; }) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};
module.exports = nextConfig;
