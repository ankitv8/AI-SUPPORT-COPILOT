/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdf-parse'],
  outputFileTracingIncludes: {
    '/api/demo/parse': ['./node_modules/pdf-parse/**/*'],
  },
}

export default nextConfig
