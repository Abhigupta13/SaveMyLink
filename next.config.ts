import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false, // dev badge overlapped the rail's profile avatar
  // Allow connections from Docker, WSL, or local network IPs
  allowedDevOrigins: ['euvya-2409-40f2-4f-cf41-57c1-4c18-7f54-183d.free.pinggy.net', 'ytbgb-2405-201-d044-7016-187d-d66-aabf-54cb.run.pinggy-free.link', '172.19.128.1', '192.168.137.1', '192.168.145.1', '10.65.163.48', 'fcero-157-50-184-107.run.pinggy-free.link'],
  experimental: {
    // MOM audio uploads (~14MB/hr opus) + d-locker files; default is 1MB
    serverActions: { bodySizeLimit: '30mb' },
  },
} as any;

export default nextConfig;
