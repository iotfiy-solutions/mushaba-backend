const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

async function migrateUserStatus() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Find all users without status field and update them
    const usersWithoutStatus = await User.find({ status: { $exists: false } });
    console.log(`📊 Found ${usersWithoutStatus.length} users without status field`);

    if (usersWithoutStatus.length > 0) {
      // Update all users to have 'active' status
      const result = await User.updateMany(
        { status: { $exists: false } },
        { 
          $set: { 
            status: 'active',
            lastSeen: new Date()
          } 
        }
      );
      
      console.log(`✅ Updated ${result.modifiedCount} users with status: 'active'`);
    } else {
      console.log('✅ All users already have status field');
    }

    // Verify the update
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ status: 'active' });
    const inactiveUsers = await User.countDocuments({ status: 'inactive' });
    const suspendedUsers = await User.countDocuments({ status: 'suspended' });
    
    console.log('\n📈 User Status Summary:');
    console.log(`Total Users: ${totalUsers}`);
    console.log(`Active Users: ${activeUsers}`);
    console.log(`Inactive Users: ${inactiveUsers}`);
    console.log(`Suspended Users: ${suspendedUsers}`);

    console.log('\n🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run migration
migrateUserStatus();
