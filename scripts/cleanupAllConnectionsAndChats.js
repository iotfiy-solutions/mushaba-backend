const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mushaba';

async function cleanupAllData() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB successfully');

    // Get all collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('📋 Available collections:', collections.map(c => c.name));

    // Clean up in order to avoid foreign key constraints
    console.log('\n🧹 Starting cleanup process...');

    // 1. Delete all messages first
    console.log('🗑️  Deleting all messages...');
    const Message = require('../models/Message');
    const messageResult = await Message.deleteMany({});
    console.log(`✅ Deleted ${messageResult.deletedCount} messages`);

    // 2. Delete all chats (both group and private)
    console.log('🗑️  Deleting all chats...');
    const Chat = require('../models/Chat');
    const chatResult = await Chat.deleteMany({});
    console.log(`✅ Deleted ${chatResult.deletedCount} chats`);

    // 3. Delete all connections
    console.log('🗑️  Deleting all connections...');
    const Connection = require('../models/Connection');
    const connectionResult = await Connection.deleteMany({});
    console.log(`✅ Deleted ${connectionResult.deletedCount} connections`);

    // 4. Delete all connection requests
    console.log('🗑️  Deleting all connection requests...');
    const ConnectionRequest = require('../models/ConnectionRequest');
    const connectionRequestResult = await ConnectionRequest.deleteMany({});
    console.log(`✅ Deleted ${connectionRequestResult.deletedCount} connection requests`);

    // 5. Delete all notifications
    console.log('🗑️  Deleting all notifications...');
    const Notification = require('../models/Notification');
    const notificationResult = await Notification.deleteMany({});
    console.log(`✅ Deleted ${notificationResult.deletedCount} notifications`);

    // 6. Delete all activity logs
    console.log('🗑️  Deleting all activity logs...');
    const ActivityLog = require('../models/ActivityLog');
    const activityLogResult = await ActivityLog.deleteMany({});
    console.log(`✅ Deleted ${activityLogResult.deletedCount} activity logs`);

    // 7. Delete all pin locations
    console.log('🗑️  Deleting all pin locations...');
    const PinLocation = require('../models/PinLocation');
    const pinLocationResult = await PinLocation.deleteMany({});
    console.log(`✅ Deleted ${pinLocationResult.deletedCount} pin locations`);

    // 8. Delete all locations
    console.log('🗑️  Deleting all locations...');
    const Location = require('../models/Location');
    const locationResult = await Location.deleteMany({});
    console.log(`✅ Deleted ${locationResult.deletedCount} locations`);

    // 9. Delete all uploads (optional - keep if you want to preserve files)
    console.log('🗑️  Deleting all uploads...');
    const fs = require('fs');
    const path = require('path');
    const uploadsDir = path.join(__dirname, '../uploads');
    
    if (fs.existsSync(uploadsDir)) {
      const deleteUploads = (dirPath) => {
        if (fs.existsSync(dirPath)) {
          fs.readdirSync(dirPath).forEach((file) => {
            const curPath = path.join(dirPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
              deleteUploads(curPath);
            } else {
              fs.unlinkSync(curPath);
            }
          });
          fs.rmdirSync(dirPath);
        }
      };
      
      deleteUploads(uploadsDir);
      console.log('✅ Deleted all uploads');
    } else {
      console.log('ℹ️  No uploads directory found');
    }

    console.log('\n🎉 CLEANUP COMPLETE!');
    console.log('📊 Summary:');
    console.log(`   • Messages: ${messageResult.deletedCount}`);
    console.log(`   • Chats: ${chatResult.deletedCount}`);
    console.log(`   • Connections: ${connectionResult.deletedCount}`);
    console.log(`   • Connection Requests: ${connectionRequestResult.deletedCount}`);
    console.log(`   • Notifications: ${notificationResult.deletedCount}`);
    console.log(`   • Activity Logs: ${activityLogResult.deletedCount}`);
    console.log(`   • Pin Locations: ${pinLocationResult.deletedCount}`);
    console.log(`   • Locations: ${locationResult.deletedCount}`);
    
    console.log('\n🚀 Database is now clean and ready for testing the fixed logic!');
    console.log('💡 Next steps:');
    console.log('   1. Create new connections');
    console.log('   2. Test group chat creation');
    console.log('   3. Test user joining existing connections');
    console.log('   4. Verify only one group chat per connection');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the cleanup
cleanupAllData();