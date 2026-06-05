import { Pool, neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '../prisma/generated/client';
import ws from 'ws';
import dns from 'dns';

// Fix local DNS resolution issues with Neon when ISP/router blocks neon.tech
if (process.env.NODE_ENV !== "production") {
  const customResolver = new dns.Resolver();
  customResolver.setServers(['8.8.8.8', '8.8.4.4']);
  
  type LookupCallback = (
    err: NodeJS.ErrnoException | null,
    address: string | Array<{ address: string; family: number }>,
    family?: number,
  ) => void;
  type LookupOptions = { all?: boolean } & Record<string, unknown>;

  const originalLookup = dns.lookup as unknown as (
    hostname: string,
    options: LookupOptions,
    callback: LookupCallback,
  ) => void;

  (dns as unknown as { lookup: unknown }).lookup = function (
    hostname: string,
    options: LookupOptions | LookupCallback,
    callback?: LookupCallback,
  ) {
    let opts: LookupOptions;
    let cb: LookupCallback;
    if (typeof options === 'function') {
      cb = options;
      opts = {};
    } else {
      opts = options;
      cb = callback as LookupCallback;
    }
    if (hostname.includes('neon.tech')) {
      customResolver.resolve4(hostname, (err, addresses) => {
        if (err) return originalLookup(hostname, opts, cb);
        if (opts.all) {
          return cb(null, addresses.map(addr => ({ address: addr, family: 4 })));
        }
        return cb(null, addresses[0], 4);
      });
      return;
    }
    return originalLookup(hostname, opts, cb);
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
