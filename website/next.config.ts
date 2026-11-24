import type { NextConfig } from 'next'

const config: NextConfig = {
  // This directory is a standalone Vercel project, beside the Python/Vite app.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
}

export default config
