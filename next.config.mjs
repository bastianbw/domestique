/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export so the app is a pure PWA: deployable to Vercel, Netlify,
  // GitHub Pages, or draggable to any static host. No backend, no server runtime.
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
