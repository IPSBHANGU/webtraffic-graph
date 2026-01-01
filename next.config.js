/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable React Strict Mode to prevent double WebSocket connections in development
  reactStrictMode: false,
}

module.exports = nextConfig
