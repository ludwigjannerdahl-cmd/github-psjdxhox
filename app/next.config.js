/** @type {import('next').NextConfig} */
const nextConfig = {
    typescript: {
      // Allow production builds to succeed even if there are TypeScript errors
      ignoreBuildErrors: true,
    },
  };
  
  module.exports = nextConfig;
  