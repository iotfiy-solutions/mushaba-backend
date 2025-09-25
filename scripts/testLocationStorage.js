const mongoose = require('mongoose');
const { ConnectionLocation } = require('../models/Location');
const Connection = require('../models/Connection');
require('dotenv').config();

const testLocationStorage = async () => {
  try {
    // Connect to database using the same env variable as the server
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Check if we have any connections
    const connections = await Connection.find({
      'metadata.status': 'active'
    }).limit(5);

    console.log(`📊 Found ${connections.length} active connections`);

    if (connections.length === 0) {
      console.log('❌ No active connections found. Please create a connection first.');
      process.exit(1);
    }

    // Check if connection location documents exist
    for (const connection of connections) {
      console.log(`\n🔍 Checking connection: ${connection._id}`);
      
      const connectionLocation = await ConnectionLocation.findOne({ 
        connectionId: connection._id 
      });

      if (connectionLocation) {
        console.log(`✅ Connection location document exists`);
        console.log(`   - Users: ${connectionLocation.users.length}`);
        console.log(`   - Total locations: ${connectionLocation.connectionStats.totalLocations}`);
        console.log(`   - Last activity: ${connectionLocation.connectionStats.lastActivity}`);
        
        // Show user details
        connectionLocation.users.forEach(user => {
          console.log(`   👤 User ${user.userId}: ${user.stats.totalLocations} locations, online: ${user.currentLocation.online}`);
        });
      } else {
        console.log(`❌ No connection location document found`);
      }
    }

    console.log('\n🎯 Test completed successfully!');
    console.log('💡 Now when you send location updates from frontend, they will be stored in the database.');
    
    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
};

testLocationStorage();
