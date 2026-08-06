/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  webpack(config, { dev }) {
    if (dev) {
      config.cache = false;
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/.git/**",
          "**/.next/**",
          "**/node_modules/**/.cache/**",
          "**/System Volume Information/**",
          "**/$RECYCLE.BIN/**",
          "E:/System Volume Information/**",
          "E:/$RECYCLE.BIN/**",
          "E:/**/System Volume Information/**",
          "E:/**/$RECYCLE.BIN/**",
        ],
      };
    }

    return config;
  },
};
