import "server-only";

import { MongoClient, type Db } from "mongodb";

import { env } from "./env";

/**
 * One pooled Mongo client for the process.
 *
 * The connection promise is parked on `globalThis` rather than a module-scoped
 * variable: Next replaces the module registry on every hot reload, so a plain
 * `let` opens a fresh pool per edit and leaks the old one until the driver's
 * sockets time out. Caching the *promise* also collapses a burst of concurrent
 * first-callers into a single connect instead of racing several.
 */

const CACHE = Symbol.for("playeon.mongo");

type Cache = { promise: Promise<Db> | null };

const globalCache = globalThis as typeof globalThis & { [CACHE]?: Cache };
const cache: Cache = (globalCache[CACHE] ??= { promise: null });

export function mongoConfigured(): boolean {
  return Boolean(env.mongoUri && env.mongoDb);
}

export function getDb(): Promise<Db> {
  if (!env.mongoUri || !env.mongoDb) {
    return Promise.reject(new Error("mongo not configured"));
  }

  cache.promise ??= new MongoClient(env.mongoUri, {
    maxPoolSize: 10,
    // fail fast: every caller here has a working degraded path, so a hung
    // connect would turn a Mongo hiccup into a hung request instead
    serverSelectionTimeoutMS: 3000,
  })
    .connect()
    .then((client) => client.db(env.mongoDb!))
    .catch((error) => {
      // let the next caller retry rather than caching a rejected promise
      cache.promise = null;
      throw error;
    });

  return cache.promise;
}
