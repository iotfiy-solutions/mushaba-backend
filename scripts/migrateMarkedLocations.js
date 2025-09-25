const mongoose = require('mongoose');
const User = require('../models/User');
const Connection = require('../models/Connection');
require('dotenv').config();

// Connect to database
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected for migration');
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
};

// Migration function to move personal locations to user collection
const migratePersonalLocations = async () => {
  try {
    console.log('Starting migration of personal locations...');
    
    const connections = await Connection.find({});
    console.log(`Found ${connections.length} connections to process`);
    
    let migratedCount = 0;
    let errorCount = 0;
    
    for (const connection of connections) {
      try {
        // Find personal locations in connection
        const personalLocations = connection.markedLocations.filter(
          loc => loc.source === 'personal'
        );
        
        console.log(`Processing connection ${connection._id}: ${personalLocations.length} personal locations`);
        
        for (const location of personalLocations) {
          try {
            // Find the user who marked this location
            const user = await User.findById(location.markedBy);
            if (!user) {
              console.log(`User ${location.markedBy} not found for location ${location._id}`);
              continue;
            }
            
            // Add to user's active locations
            const locationField = location.type === 'bus_station' ? 'busStation' : 'hotel';
            
            const updateData = {
              [`activeLocations.${locationField}.name`]: location.name,
              [`activeLocations.${locationField}.latitude`]: location.latitude,
              [`activeLocations.${locationField}.longitude`]: location.longitude,
              [`activeLocations.${locationField}.source`]: 'personal',
              [`activeLocations.${locationField}.locationId`]: location._id,
              [`activeLocations.${locationField}.connectionId`]: connection._id,
              [`activeLocations.${locationField}.isMarked`]: true,
              [`activeLocations.${locationField}.lastUpdated`]: new Date()
            };
            
            if (location.type === 'hotel' && location.roomNumber) {
              updateData[`activeLocations.${locationField}.roomNumber`] = location.roomNumber;
            }
            
            await User.findByIdAndUpdate(user._id, updateData);
            migratedCount++;
            
            console.log(`Migrated ${location.type} for user ${user.username}`);
          } catch (userError) {
            console.error(`Error migrating location ${location._id} for user ${location.markedBy}:`, userError.message);
            errorCount++;
          }
        }
        
        // Remove personal locations from connection
        connection.markedLocations = connection.markedLocations.filter(
          loc => loc.source !== 'personal'
        );
        await connection.save();
        
        console.log(`Removed personal locations from connection ${connection._id}`);
      } catch (connectionError) {
        console.error(`Error processing connection ${connection._id}:`, connectionError.message);
        errorCount++;
      }
    }
    
    console.log(`Migration completed:`);
    console.log(`- Migrated: ${migratedCount} locations`);
    console.log(`- Errors: ${errorCount} locations`);
    
  } catch (error) {
    console.error('Migration failed:', error);
  }
};

// Migration function to sync existing group locations to all users
const syncExistingGroupLocations = async () => {
  try {
    console.log('Starting sync of existing group locations...');
    
    const connections = await Connection.find({});
    let syncedCount = 0;
    
    for (const connection of connections) {
      try {
        const groupLocations = connection.markedLocations.filter(
          loc => loc.source === 'group' || !loc.source // Handle old data without source field
        );
        
        console.log(`Syncing ${groupLocations.length} group locations for connection ${connection._id}`);
        
        for (const groupLocation of groupLocations) {
          // Update source to 'group' if not set
          if (!groupLocation.source) {
            groupLocation.source = 'group';
          }
          
          // Sync to all users in connection
          const users = await User.find({
            _id: { $in: connection.users.map(u => u.userId) }
          });
          
          for (const user of users) {
            const locationField = groupLocation.type === 'bus_station' ? 'busStation' : 'hotel';
            
            // Check if user already has personal location for this type
            const hasPersonal = user.activeLocations[locationField].source === 'personal';
            
            if (!hasPersonal) {
              const updateData = {
                [`activeLocations.${locationField}.name`]: groupLocation.name,
                [`activeLocations.${locationField}.latitude`]: groupLocation.latitude,
                [`activeLocations.${locationField}.longitude`]: groupLocation.longitude,
                [`activeLocations.${locationField}.source`]: 'group',
                [`activeLocations.${locationField}.locationId`]: groupLocation._id,
                [`activeLocations.${locationField}.connectionId`]: connection._id,
                [`activeLocations.${locationField}.isMarked`]: true,
                [`activeLocations.${locationField}.lastUpdated`]: new Date()
              };
              
              await User.findByIdAndUpdate(user._id, updateData);
              syncedCount++;
            }
          }
        }
        
        // Save connection with updated source
        await connection.save();
        
      } catch (connectionError) {
        console.error(`Error syncing connection ${connection._id}:`, connectionError.message);
      }
    }
    
    console.log(`Sync completed: ${syncedCount} locations synced to users`);
    
  } catch (error) {
    console.error('Sync failed:', error);
  }
};

// Main migration function
const runMigration = async () => {
  try {
    await connectDB();
    
    console.log('Starting marked locations migration...');
    console.log('This will:');
    console.log('1. Move personal locations from Connection to User collections');
    console.log('2. Sync existing group locations to all users');
    console.log('3. Update source fields for consistency');
    
    // Step 1: Migrate personal locations
    await migratePersonalLocations();
    
    // Step 2: Sync group locations
    await syncExistingGroupLocations();
    
    console.log('Migration completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

// Run migration if called directly
if (require.main === module) {
  runMigration();
}

module.exports = {
  migratePersonalLocations,
  syncExistingGroupLocations,
  runMigration
};



