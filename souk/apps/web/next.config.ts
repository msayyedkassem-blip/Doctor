import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship as TypeScript-built ESM; Next must transpile them.
  transpilePackages: ['@souk/core', '@souk/db'],
  // Prisma's query engine is a native binary — keep it out of the bundle.
  serverExternalPackages: ['@prisma/client', '.prisma/client'],
};

export default config;
