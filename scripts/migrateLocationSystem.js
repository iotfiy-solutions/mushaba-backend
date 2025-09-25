/**
 * Migration Script for Enhanced Location System
 * Migrates existing markedLocations to new schema with scope and ownership tracking
 */

const mongoose = require('mongoose');
const Connection = require('../models/Connection');
const User = require('../models/User');
require('dotenv').config();

const migrateLocationSystem = async () => {
  try {
    console.log('🚀 Starting Location System Migration...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mushaba');
    console.log('✅ Connected to MongoDB');

    // Get all connections with markedLocations
    const connections = await Connection.find({
      'markedLocations.0': { $exists: true }
    });

    console.log(`📊 Found ${connections.length} connections with marked locations`);

    let migratedCount = 0;
    let errorCount = 0;

    for (const connection of connections) {
      try {
        console.log(`\n🔄 Migrating connection: ${connection._id}`);
        
        // Find the owner of this connection
        const owner = connection.users.find(user => user.role === 'owner');
        if (!owner) {
          console.log('❌ No owner found for connection, skipping...');
          continue;
        }

        // Migrate each marked location
        const updatedMarkedLocations = connection.markedLocations.map(location => {
          return {
            ...location.toObject(),
            // Set new fields based on existing data
            isOwnerMarked: true, // All existing locations are owner marked
            isPersonalMarked: false,
            scope: {
              type: 'group', // All existing locations are group locations
              userId: null, // Group locations have no specific user
              isOwnerPersonal: true // These are owner's personal too
            }
          };
        });

        // Update the connection
        await Connection.findByIdAndUpdate(connection._id, {
          markedLocations: updatedMarkedLocations
        });

        // Update all users' cache for this connection
        await updateUsersCacheForConnection(connection._id, owner.userId);

        migratedCount++;
        console.log(`✅ Migrated connection ${connection._id}`);

      } catch (error) {
        console.error(`❌ Error migrating connection ${connection._id}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n🎉 Migration completed!');
    console.log(`✅ Successfully migrated: ${migratedCount} connections`);
    console.log(`❌ Errors: ${errorCount} connections`);

  } catch (error) {
    console.error('💥 Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
};

/**
 * Update all users' cache for a specific connection
 */
const updateUsersCacheForConnection = async (connectionId, ownerId) => {
  try {
    const connection = await Connection.findById(connectionId);
    if (!connection) return;

    // Get group locations
    const groupLocations = connection.markedLocations.filter(loc => loc.scope.type === 'group');
    const busLocation = groupLocations.find(loc => loc.type === 'bus_station');
    const hotelLocation = groupLocations.find(loc => loc.type === 'hotel');

    // Update all users in the connection
    for (const userInConnection of connection.users) {
      const userId = userInConnection.userId;
      const isOwner = userId.toString() === ownerId.toString();

      // Prepare cache data
      const cacheData = {
        busStation: {
          name: busLocation?.name || "Unmarked",
          latitude: busLocation?.latitude || null,
          longitude: busLocation?.longitude || null,
          source: 'group',
          locationId: busLocation?._id || null,
          connectionId: connectionId,
          isMarked: !!busLocation,
          lastUpdated: new Date()
        },
        hotel: {
          name: hotelLocation?.name || "Unmarked",
          roomNumber: hotelLocation?.roomNumber || null,
          latitude: hotelLocation?.latitude || null,
          longitude: hotelLocation?.longitude || null,
          source: 'group',
          locationId: hotelLocation?._id || null,
          connectionId: connectionId,
          isMarked: !!hotelLocation,
          lastUpdated: new Date()
        }
      };

      // Update user's cache
      await User.findByIdAndUpdate(userId, {
        $set: {
          'activeLocations.busStation': cacheData.busStation,
          'activeLocations.hotel': cacheData.hotel
        }
      });

      console.log(`  📝 Updated cache for user: ${userId}`);
    }

  } catch (error) {
    console.error('Error updating users cache:', error);
  }
};

/**
 * Verify migration results
 */
const verifyMigration = async () => {
  try {
    console.log('\n🔍 Verifying migration results...');
    
    const connections = await Connection.find({
      'markedLocations.0': { $exists: true }
    });

    let verifiedCount = 0;
    let issuesCount = 0;

    for (const connection of connections) {
      const hasNewFields = connection.markedLocations.some(loc => 
        loc.scope && loc.isOwnerMarked !== undefined
      );

      if (hasNewFields) {
        verifiedCount++;
      } else {
        issuesCount++;
        console.log(`⚠️  Connection ${connection._id} missing new fields`);
      }
    }

    console.log(`✅ Verified: ${verifiedCount} connections`);
    console.log(`⚠️  Issues: ${issuesCount} connections`);

  } catch (error) {
    console.error('Error verifying migration:', error);
  }
};

// Run migration if called directly
if (require.main === module) {
  migrateLocationSystem()
    .then(() => verifyMigration())
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = {
  migrateLocationSystem,
  updateUsersCacheForConnection,
  verifyMigration
};

