import path from "node:path";
import os from "node:os";
import type { NextConfig } from "next";

function getLocalIps(): string[] {
  const ips: string[] = ["localhost", "127.0.0.1", "playeon-bot.xysushi.in", "playeon.xysushi.in"];
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const net of ifaces[name] ?? []) {
        if (net.family === "IPv4" && !net.internal) {
          ips.push(net.address);
        }
      }
    }
  } catch {}
  return ips;
}

const nextConfig: NextConfig = {
  allowedDevOrigins: getLocalIps(),
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
