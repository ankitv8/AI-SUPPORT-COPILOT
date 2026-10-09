/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node', 'sharp', 'pdf-parse'],
  outputFileTracingIncludes: {
    '/api/demo/parse': ['./node_modules/pdf-parse/**/*'],
    '/api/demo/ingest': [
      './node_modules/sharp/**/*',
      './node_modules/@img/**/*',
      './node_modules/onnxruntime-node/**/*',
      './node_modules/@huggingface/transformers/**/*',
    ],
    '/api/chat': [
      './node_modules/sharp/**/*',
      './node_modules/@img/**/*',
      './node_modules/onnxruntime-node/**/*',
      './node_modules/@huggingface/transformers/**/*',
    ],
  },
}

export default nextConfig
