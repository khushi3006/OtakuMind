import { Pool, neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '../prisma/generated/client';
import ws from 'ws';
import dns from 'dns';

// Fix local DNS resolution issues with Neon when ISP/router blocks neon.tech
if (process.env.NODE_ENV !== "production") {
  const customResolver = new dns.Resolver();
  customResolver.setServers(['8.8.8.8', '8.8.4.4']);
  
  const originalLookup = dns.lookup;
  (dns as any).lookup = function(hostname: string, options: any, callback: any) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    if (hostname.includes('neon.tech')) {
      customResolver.resolve4(hostname, (err, addresses) => {
        if (err) return originalLookup(hostname, options, callback);
        if (options && options.all) {
          return callback(null, addresses.map(addr => ({ address: addr, family: 4 })));
        }
        return callback(null, addresses[0], 4);
      });
      return;
    }
    return originalLookup(hostname, options, callback);
  };
}

// Set up WebSocket constructor for Node.js environment
neonConfig.webSocketConstructor = ws;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const createPrismaClient = () => {
  const connectionString = process.env.DATABASE_URL!;
  const pool = new Pool({ connectionString });
  const adapter = new PrismaNeon(pool);
  return new PrismaClient({ adapter });
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
