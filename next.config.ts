import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow connections from Docker, WSL, or local network IPs
  allowedDevOrigins: ['172.19.128.1', '192.168.137.1', '192.168.145.1', '10.65.163.48', 'fcero-157-50-184-107.run.pinggy-free.link'],
} as any;

export default nextConfig;
