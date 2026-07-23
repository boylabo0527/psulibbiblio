/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth", "pdfkit", "exceljs", "docx", "@huggingface/transformers", "onnxruntime-node"],
  },
};
module.exports = nextConfig;
