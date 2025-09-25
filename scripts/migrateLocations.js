const mongoose = require('mongoose');
const { ConnectionLocation } = require('../models/Location');
const Connection = require('../models/Connection');
require('dotenv').config();

const migrateLocations = async () => {
  try {
    // Connect to database using the same env variable as the server
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Get all active connections
    const connections = await Connection.find({
      'metadata.status': 'active'
    });

    console.log(`📊 Found ${connections.length} active connections`);

    for (const connection of connections) {
      console.log(`🔍 Processing connection: ${connection._id}`);
      
      // Check if connection location document already exists
      const existingLocation = await ConnectionLocation.findOne({ connectionId: connection._id });
      if (existingLocation) {
        console.log(`✅ Connection location already exists for: ${connection._id}`);
        continue;
      }

      // Create connection location document
      const connectionLocation = new ConnectionLocation({
        connectionId: connection._id,
        users: connection.users.map(user => ({
          userId: user.userId,
          currentLocation: {
            latitude: null,
            longitude: null,
            floor: null,
            lastUpdated: null,
            online: false
          },
          locationHistory: [],
          stats: {
            totalLocations: 0,
            lastActive: null,
            averageSpeed: 0,
            totalDistance: 0
          }
        })),
        connectionStats: {
          lastActivity: connection.metadata.lastActivity || new Date(),
          activeUsers: 0,
          totalLocations: 0
        }
      });

      await connectionLocation.save();
      console.log(`✅ Created connection location for: ${connection._id}`);
    }

    console.log('\n🎯 Migration completed successfully!');
    console.log('💡 Database structure is now ready for location storage.');
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

migrateLocations();
