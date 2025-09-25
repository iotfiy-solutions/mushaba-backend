const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

class RedisService {
  // Cache connection
  static async cacheConnection(userId1, userId2, connectionData) {
    const key1 = `connection:${userId1}:${userId2}`;
    const key2 = `connection:${userId2}:${userId1}`;
    
    await Promise.all([
      redis.set(key1, JSON.stringify(connectionData)),
      redis.set(key2, JSON.stringify(connectionData))
    ]);
  }

  // Get connection from cache
  static async getConnection(userId1, userId2) {
    const key = `connection:${userId1}:${userId2}`;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  // Get all connections for a user
  static async getUserConnections(userId) {
    const pattern = `connection:${userId}:*`;
    const keys = await redis.keys(pattern);
    const connections = await Promise.all(
      keys.map(key => redis.get(key))
    );
    return connections
      .filter(Boolean)
      .map(conn => JSON.parse(conn));
  }

  // Remove connection from cache
  static async removeConnection(userId1, userId2) {
    const key1 = `connection:${userId1}:${userId2}`;
    const key2 = `connection:${userId2}:${userId1}`;
    await Promise.all([
      redis.del(key1),
      redis.del(key2)
    ]);
  }
}

module.exports = RedisService; 