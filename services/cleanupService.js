const PinLocation = require('../models/PinLocation');
const Connection = require('../models/Connection');
const User = require('../models/User');
const { ConnectionLocation } = require('../models/Location');
const webSocketService = require('./websocketService');

class CleanupService {
  constructor() {
    this.isRunning = false;
    this.cleanupInterval = null;
    this.stats = {
      lastCleanup: null,
      totalCleanups: 0,
      totalExpiredPins: 0,
      totalExpiredConnections: 0,
      totalInactiveUsers: 0
    };
  }

  start() {
    if (this.isRunning) {
      console.log('[CLEANUP_SERVICE] Service is already running');
      return;
    }

    this.isRunning = true;
    
    // Run cleanup every 30 minutes
    this.cleanupInterval = setInterval(() => {
      this.runCleanup();
    }, 30 * 60 * 1000);

    // Run initial cleanup after 5 minutes
    setTimeout(() => {
      this.runCleanup();
    }, 5 * 60 * 1000);

    console.log('[CLEANUP_SERVICE] Service started successfully');
  }

  stop() {
    if (!this.isRunning) {
      console.log('[CLEANUP_SERVICE] Service is not running');
      return;
    }

    this.isRunning = false;
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    console.log('[CLEANUP_SERVICE] Service stopped');
  }

  async runCleanup() {
    if (!this.isRunning) return;

    const startTime = Date.now();
    console.log('[CLEANUP_SERVICE] Starting cleanup process...');

    try {
      const results = await Promise.allSettled([
        this.cleanupExpiredPinLocations(),
        this.cleanupExpiredConnections(),
        this.cleanupInactiveUsers(),
        this.cleanupOrphanedData()
      ]);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Update stats
      this.stats.lastCleanup = new Date();
      this.stats.totalCleanups++;

      // Log results
      console.log(`[CLEANUP_SERVICE] Cleanup completed in ${duration}ms`);
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          console.log(`[CLEANUP_SERVICE] Task ${index + 1} completed:`, result.value);
        } else {
          console.error(`[CLEANUP_SERVICE] Task ${index + 1} failed:`, result.reason);
        }
      });

    } catch (error) {
      console.error('[CLEANUP_SERVICE] Error during cleanup:', error);
    }
  }

  async cleanupExpiredPinLocations() {
    try {
      const now = new Date();
      
      // Find expired pin locations
      const expiredPins = await PinLocation.find({
        expiresAt: { $lte: now },
        isActive: true
      });

      if (expiredPins.length === 0) {
        console.log('[CLEANUP_SERVICE] No expired pin locations found');
        return { expiredPins: 0, deletedPins: 0 };
      }

      console.log(`[CLEANUP_SERVICE] Found ${expiredPins.length} expired pin locations`);

      // Mark as inactive instead of deleting to maintain chat message references
      const updateResult = await PinLocation.updateMany(
        { _id: { $in: expiredPins.map(pin => pin._id) } },
        { 
          isActive: false,
          updatedAt: now
        }
      );

      // Notify users about expired pins via WebSocket
      const connectionIds = [...new Set(expiredPins.map(pin => pin.connectionId.toString()))];
      connectionIds.forEach(connectionId => {
        webSocketService.emitToConnection(connectionId, 'pinLocationsExpired', {
          expiredPinIds: expiredPins
            .filter(pin => pin.connectionId.toString() === connectionId)
            .map(pin => pin._id)
        });
      });

      this.stats.totalExpiredPins += expiredPins.length;

      console.log(`[CLEANUP_SERVICE] Marked ${updateResult.modifiedCount} pin locations as inactive`);
      
      return {
        expiredPins: expiredPins.length,
        deletedPins: updateResult.modifiedCount
      };

    } catch (error) {
      console.error('[CLEANUP_SERVICE] Error cleaning up expired pin locations:', error);
      throw error;
    }
  }

  async cleanupExpiredConnections() {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

      // Find connections that haven't been active for 30 days
      const expiredConnections = await Connection.find({
        'metadata.lastActivity': { $lt: thirtyDaysAgo },
        'metadata.status': 'active'
      });

      if (expiredConnections.length === 0) {
        console.log('[CLEANUP_SERVICE] No expired connections found');
        return { expiredConnections: 0, deactivatedConnections: 0 };
      }

      console.log(`[CLEANUP_SERVICE] Found ${expiredConnections.length} expired connections`);

      // Mark connections as inactive
      const updateResult = await Connection.updateMany(
        { _id: { $in: expiredConnections.map(conn => conn._id) } },
        { 
          'metadata.status': 'inactive',
          'metadata.lastActivity': now
        }
      );

      this.stats.totalExpiredConnections += expiredConnections.length;

      console.log(`[CLEANUP_SERVICE] Marked ${updateResult.modifiedCount} connections as inactive`);
      
      return {
        expiredConnections: expiredConnections.length,
        deactivatedConnections: updateResult.modifiedCount
      };

    } catch (error) {
      console.error('[CLEANUP_SERVICE] Error cleaning up expired connections:', error);
      throw error;
    }
  }

  async cleanupInactiveUsers() {
    try {
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));

      // Find users who haven't been active for 90 days
      const inactiveUsers = await User.find({
        lastSeen: { $lt: ninetyDaysAgo },
        status: 'online'
      });

      if (inactiveUsers.length === 0) {
        console.log('[CLEANUP_SERVICE] No inactive users found');
        return { inactiveUsers: 0, updatedUsers: 0 };
      }

      console.log(`[CLEANUP_SERVICE] Found ${inactiveUsers.length} inactive users`);

      // Mark users as offline
      const updateResult = await User.updateMany(
        { _id: { $in: inactiveUsers.map(user => user._id) } },
        { 
          status: 'offline',
          lastSeen: now
        }
      );

      this.stats.totalInactiveUsers += inactiveUsers.length;

      console.log(`[CLEANUP_SERVICE] Marked ${updateResult.modifiedCount} users as offline`);
      
      return {
        inactiveUsers: inactiveUsers.length,
        updatedUsers: updateResult.modifiedCount
      };

    } catch (error) {
      console.error('[CLEANUP_SERVICE] Error cleaning up inactive users:', error);
      throw error;
    }
  }

  async cleanupOrphanedData() {
    try {
      let cleanedCount = 0;

      // Clean up orphaned connection locations
      if (ConnectionLocation) {
        const orphanedLocations = await ConnectionLocation.find({
          connectionId: { $exists: true }
        });

        for (const location of orphanedLocations) {
          const connectionExists = await Connection.findById(location.connectionId);
          if (!connectionExists) {
            await ConnectionLocation.findByIdAndDelete(location._id);
            cleanedCount++;
          }
        }

        if (cleanedCount > 0) {
          console.log(`[CLEANUP_SERVICE] Cleaned up ${cleanedCount} orphaned connection locations`);
        }
      }

      return { orphanedData: cleanedCount };

    } catch (error) {
      console.error('[CLEANUP_SERVICE] Error cleaning up orphaned data:', error);
      throw error;
    }
  }

  // Manual cleanup methods for admin use
  async manualCleanupExpiredPins() {
    console.log('[CLEANUP_SERVICE] Manual cleanup of expired pins requested');
    return await this.cleanupExpiredPinLocations();
  }

  async manualCleanupAll() {
    console.log('[CLEANUP_SERVICE] Manual cleanup of all expired data requested');
    return await this.runCleanup();
  }

  // Get service status and statistics
  getStatus() {
    return {
      isRunning: this.isRunning,
      stats: this.stats,
      nextCleanup: this.cleanupInterval ? 
        new Date(Date.now() + 30 * 60 * 1000) : null
    };
  }

  // Force immediate cleanup
  async forceCleanup() {
    console.log('[CLEANUP_SERVICE] Force cleanup requested');
    return await this.runCleanup();
  }
}

module.exports = new CleanupService();
