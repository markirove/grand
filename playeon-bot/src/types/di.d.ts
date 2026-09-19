import type { Collections } from '../services/mongo.js'
import type { CacheService } from '../services/redis.js'
import type { Logger } from '../services/logger.js'
import type { config } from '../config.js'

declare module '@mtcute/dispatcher' {
  interface DispatcherDependencies {
    db: Collections
    cache: CacheService
    logger: Logger
    config: typeof config
  }
}
