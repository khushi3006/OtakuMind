
Object.defineProperty(exports, "__esModule", { value: true });

const {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  PrismaClientRustPanicError,
  PrismaClientInitializationError,
  PrismaClientValidationError,
  NotFoundError,
  getPrismaClient,
  sqltag,
  empty,
  join,
  raw,
  skip,
  Decimal,
  Debug,
  objectEnumValues,
  makeStrictEnum,
  Extensions,
  warnOnce,
  defineDmmfProperty,
  Public,
  getRuntime
} = require('./runtime/wasm.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = PrismaClientKnownRequestError;
Prisma.PrismaClientUnknownRequestError = PrismaClientUnknownRequestError
Prisma.PrismaClientRustPanicError = PrismaClientRustPanicError
Prisma.PrismaClientInitializationError = PrismaClientInitializationError
Prisma.PrismaClientValidationError = PrismaClientValidationError
Prisma.NotFoundError = NotFoundError
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = sqltag
Prisma.empty = empty
Prisma.join = join
Prisma.raw = raw
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = Extensions.getExtensionContext
Prisma.defineExtension = Extensions.defineExtension

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}





/**
 * Enums
 */
exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  email: 'email',
  username: 'username',
  password: 'password',
  name: 'name',
  bio: 'bio',
  isPublic: 'isPublic',
  createdAt: 'createdAt'
};

exports.Prisma.PendingSignupScalarFieldEnum = {
  id: 'id',
  email: 'email',
  name: 'name',
  username: 'username',
  passwordHash: 'passwordHash',
  otpHash: 'otpHash',
  attempts: 'attempts',
  expiresAt: 'expiresAt',
  lastSentAt: 'lastSentAt',
  createdAt: 'createdAt'
};

exports.Prisma.PasswordResetTokenScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  tokenHash: 'tokenHash',
  expiresAt: 'expiresAt',
  usedAt: 'usedAt',
  createdAt: 'createdAt'
};

exports.Prisma.FollowScalarFieldEnum = {
  id: 'id',
  followerId: 'followerId',
  followingId: 'followingId',
  createdAt: 'createdAt'
};

exports.Prisma.AnimeScalarFieldEnum = {
  id: 'id',
  name: 'name',
  normalizedName: 'normalizedName',
  season: 'season',
  part: 'part',
  episodesWatched: 'episodesWatched',
  totalEpisodes: 'totalEpisodes',
  status: 'status',
  imageUrl: 'imageUrl',
  malId: 'malId',
  type: 'type',
  originalOrder: 'originalOrder',
  watchOrder: 'watchOrder',
  droppedAt: 'droppedAt',
  completedAt: 'completedAt',
  airing: 'airing',
  broadcastDay: 'broadcastDay',
  broadcastTime: 'broadcastTime',
  broadcastTimezone: 'broadcastTimezone',
  broadcastString: 'broadcastString',
  airingStart: 'airingStart',
  createdAt: 'createdAt',
  userId: 'userId'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};


exports.Prisma.ModelName = {
  User: 'User',
  PendingSignup: 'PendingSignup',
  PasswordResetToken: 'PasswordResetToken',
  Follow: 'Follow',
  Anime: 'Anime'
};
/**
 * Create the Client
 */
const config = {
  "generator": {
    "name": "client",
    "provider": {
      "fromEnvVar": null,
      "value": "prisma-client-js"
    },
    "output": {
      "value": "/Users/ahmadfaraz/Codes/otakumind/OtakuMind/prisma/generated/client",
      "fromEnvVar": null
    },
    "config": {
      "engineType": "library"
    },
    "binaryTargets": [
      {
        "fromEnvVar": null,
        "value": "darwin-arm64",
        "native": true
      }
    ],
    "previewFeatures": [
      "driverAdapters"
    ],
    "sourceFilePath": "/Users/ahmadfaraz/Codes/otakumind/OtakuMind/prisma/schema.prisma",
    "isCustomOutput": true
  },
  "relativeEnvPaths": {
    "rootEnvPath": null,
    "schemaEnvPath": "../../../.env"
  },
  "relativePath": "../..",
  "clientVersion": "5.22.0",
  "engineVersion": "605197351a3c8bdd595af2d2a9bc3025bca48ea2",
  "datasourceNames": [
    "db"
  ],
  "activeProvider": "postgresql",
  "postinstall": false,
  "inlineDatasources": {
    "db": {
      "url": {
        "fromEnvVar": "DATABASE_URL",
        "value": null
      }
    }
  },
  "inlineSchema": "generator client {\n  provider        = \"prisma-client-js\"\n  previewFeatures = [\"driverAdapters\"]\n  output          = \"./generated/client\"\n}\n\ndatasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n\nmodel User {\n  id        Int      @id @default(autoincrement())\n  email     String   @unique\n  username  String   @unique\n  password  String\n  name      String?\n  bio       String?\n  isPublic  Boolean  @default(true)\n  createdAt DateTime @default(now())\n  animes    Anime[]\n\n  // Social graph (self-referential many-to-many through Follow)\n  following Follow[] @relation(\"Follower\")\n  followers Follow[] @relation(\"Following\")\n\n  passwordResetTokens PasswordResetToken[]\n\n  @@index([username])\n}\n\n// Holds signup details + hashed OTP until the email is verified. No User row\n// exists until verification succeeds (see /api/auth/signup/verify).\nmodel PendingSignup {\n  id           Int      @id @default(autoincrement())\n  email        String   @unique\n  name         String?\n  username     String?\n  passwordHash String\n  otpHash      String\n  attempts     Int      @default(0)\n  expiresAt    DateTime\n  lastSentAt   DateTime @default(now())\n  createdAt    DateTime @default(now())\n}\n\n// Single-use, time-limited tokens for the password-reset link flow.\nmodel PasswordResetToken {\n  id        Int       @id @default(autoincrement())\n  userId    Int\n  tokenHash String    @unique\n  expiresAt DateTime\n  usedAt    DateTime?\n  createdAt DateTime  @default(now())\n  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)\n\n  @@index([userId])\n}\n\nmodel Follow {\n  id          Int      @id @default(autoincrement())\n  followerId  Int\n  followingId Int\n  createdAt   DateTime @default(now())\n\n  follower  User @relation(\"Follower\", fields: [followerId], references: [id], onDelete: Cascade)\n  following User @relation(\"Following\", fields: [followingId], references: [id], onDelete: Cascade)\n\n  @@unique([followerId, followingId])\n  @@index([followerId])\n  @@index([followingId])\n}\n\nmodel Anime {\n  id                Int       @id @default(autoincrement())\n  name              String\n  normalizedName    String\n  season            Int\n  part              Int? // null = normal single season; 1,2,… = a split-cour part\n  episodesWatched   Int       @default(0)\n  totalEpisodes     Int       @default(0)\n  status            String // \"completed\", \"incomplete\", \"dropped\"\n  imageUrl          String?\n  malId             Int? // For Jikan API linking (removed @unique for multi-user compatibility)\n  type              String    @default(\"TV\") // \"TV\", \"Movie\", \"OVA\", \"Special\"\n  originalOrder     Int? // Preserves the number from 1-601\n  watchOrder        Int? // Custom drag-and-drop ordering for \"Currently Watching\"\n  droppedAt         DateTime?\n  completedAt       DateTime?\n  airing            Boolean   @default(false)\n  broadcastDay      String?\n  broadcastTime     String?\n  broadcastTimezone String?\n  broadcastString   String?\n  airingStart       String?\n  createdAt         DateTime  @default(now())\n\n  // Owner relation\n  userId Int\n  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)\n\n  // Performance indexes and user-scoped uniqueness.\n  // Season uniqueness is a PARTIAL unique index covering TV rows only, now part-aware:\n  //   CREATE UNIQUE INDEX ... (userId, normalizedName, season, part)\n  //     NULLS NOT DISTINCT WHERE type = 'TV'\n  // Prisma can't model partial / NULLS NOT DISTINCT indexes, so it lives in the\n  // migration 20260605120000_add_season_part (mirror: scripts/migrate-add-season-part.ts),\n  // not as an @@unique() here. Movies/OVAs/Specials stay unconstrained.\n  @@index([userId, status, createdAt])\n  @@index([userId, status, droppedAt])\n  @@index([userId, status, completedAt])\n  @@index([userId, status, originalOrder])\n  @@index([userId, status, watchOrder])\n  @@index([userId, normalizedName])\n}\n",
  "inlineSchemaHash": "4015bb4e173149786fe375693010daf283fb0a36eb3922c27adc4856afa90779",
  "copyEngine": true
}
config.dirname = '/'

config.runtimeDataModel = JSON.parse("{\"models\":{\"User\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"email\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"username\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"password\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"bio\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"isPublic\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"animes\",\"kind\":\"object\",\"type\":\"Anime\",\"relationName\":\"AnimeToUser\"},{\"name\":\"following\",\"kind\":\"object\",\"type\":\"Follow\",\"relationName\":\"Follower\"},{\"name\":\"followers\",\"kind\":\"object\",\"type\":\"Follow\",\"relationName\":\"Following\"},{\"name\":\"passwordResetTokens\",\"kind\":\"object\",\"type\":\"PasswordResetToken\",\"relationName\":\"PasswordResetTokenToUser\"}],\"dbName\":null},\"PendingSignup\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"email\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"username\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"passwordHash\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"otpHash\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"attempts\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"expiresAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"lastSentAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":null},\"PasswordResetToken\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"userId\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"tokenHash\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"expiresAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"usedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"user\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"PasswordResetTokenToUser\"}],\"dbName\":null},\"Follow\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"followerId\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"followingId\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"follower\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"Follower\"},{\"name\":\"following\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"Following\"}],\"dbName\":null},\"Anime\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"normalizedName\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"season\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"part\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"episodesWatched\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"totalEpisodes\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"imageUrl\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"malId\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"type\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"originalOrder\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"watchOrder\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"droppedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"completedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"airing\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"broadcastDay\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"broadcastTime\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"broadcastTimezone\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"broadcastString\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"airingStart\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"userId\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"user\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"AnimeToUser\"}],\"dbName\":null}},\"enums\":{},\"types\":{}}")
defineDmmfProperty(exports.Prisma, config.runtimeDataModel)
config.engineWasm = {
  getRuntime: () => require('./query_engine_bg.js'),
  getQueryEngineWasmModule: async () => {
    const loader = (await import('#wasm-engine-loader')).default
    const engine = (await loader).default
    return engine 
  }
}

config.injectableEdgeEnv = () => ({
  parsed: {
    DATABASE_URL: typeof globalThis !== 'undefined' && globalThis['DATABASE_URL'] || typeof process !== 'undefined' && process.env && process.env.DATABASE_URL || undefined
  }
})

if (typeof globalThis !== 'undefined' && globalThis['DEBUG'] || typeof process !== 'undefined' && process.env && process.env.DEBUG || undefined) {
  Debug.enable(typeof globalThis !== 'undefined' && globalThis['DEBUG'] || typeof process !== 'undefined' && process.env && process.env.DEBUG || undefined)
}

const PrismaClient = getPrismaClient(config)
exports.PrismaClient = PrismaClient
Object.assign(exports, Prisma)

