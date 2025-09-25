/**
 * Database Cleanup Script
 * ⚠️  WARNING: This will DELETE ALL DATA from your database!
 * 
 * This script will:
 * - Drop all collections
 * - Remove all documents
 * - Clean up indexes
 * - Reset the database to empty state
 * 
 * Usage:
 * node scripts/cleanupDatabase.js
 * 
 * ⚠️  BACKUP YOUR DATA FIRST!
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Database connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/your-database-name', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`[CLEANUP] Connected to MongoDB: ${conn.connection.host}`);
    return conn.connection;
  } catch (error) {
    console.error('[CLEANUP] Database connection error:', error);
    process.exit(1);
  }
};

// Get all collection names
const getAllCollections = async (db) => {
  try {
    const collections = await db.listCollections().toArray();
    return collections.map(col => col.name);
  } catch (error) {
    console.error('[CLEANUP] Error getting collections:', error);
    return [];
  }
};

// Drop a collection
const dropCollection = async (db, collectionName) => {
  try {
    await db.collection(collectionName).drop();
    console.log(`[CLEANUP] ✅ Dropped collection: ${collectionName}`);
    return true;
  } catch (error) {
    if (error.code === 26) {
      console.log(`[CLEANUP] ⚠️  Collection ${collectionName} doesn't exist`);
      return true;
    } else {
      console.error(`[CLEANUP] ❌ Error dropping collection ${collectionName}:`, error.message);
      return false;
    }
  }
};

// Delete all documents from a collection
const clearCollection = async (db, collectionName) => {
  try {
    const result = await db.collection(collectionName).deleteMany({});
    console.log(`[CLEANUP] ✅ Cleared ${result.deletedCount} documents from: ${collectionName}`);
    return true;
  } catch (error) {
    console.error(`[CLEANUP] ❌ Error clearing collection ${collectionName}:`, error.message);
    return false;
  }
};

// Main cleanup function
const cleanupDatabase = async () => {
  console.log('🚨 [CLEANUP] Starting database cleanup...');
  console.log('⚠️  WARNING: This will DELETE ALL DATA!');
  
  // Add a 5-second delay for safety
  console.log('⏰ Waiting 5 seconds before proceeding...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const connection = await connectDB();
  const db = connection.db;
  
  try {
    // Get all collections
    const collections = await getAllCollections(db);
    console.log(`[CLEANUP] Found ${collections.length} collections:`, collections);
    
    if (collections.length === 0) {
      console.log('[CLEANUP] No collections found. Database is already clean.');
      return;
    }
    
    // Option 1: Drop all collections (recommended)
    console.log('\n🗑️  [CLEANUP] Dropping all collections...');
    let droppedCount = 0;
    let failedCount = 0;
    
    for (const collectionName of collections) {
      const success = await dropCollection(db, collectionName);
      if (success) {
        droppedCount++;
      } else {
        failedCount++;
      }
    }
    
    console.log(`\n📊 [CLEANUP] Summary:`);
    console.log(`✅ Successfully dropped: ${droppedCount} collections`);
    console.log(`❌ Failed to drop: ${failedCount} collections`);
    
    // Option 2: Clear all documents (alternative approach)
    // Uncomment this section if you prefer to keep collections but clear data
    /*
    console.log('\n🗑️  [CLEANUP] Clearing all documents...');
    let clearedCount = 0;
    let failedClearCount = 0;
    
    for (const collectionName of collections) {
      const success = await clearCollection(db, collectionName);
      if (success) {
        clearedCount++;
      } else {
        failedClearCount++;
      }
    }
    
    console.log(`\n📊 [CLEANUP] Summary:`);
    console.log(`✅ Successfully cleared: ${clearedCount} collections`);
    console.log(`❌ Failed to clear: ${failedClearCount} collections`);
    */
    
    // Verify cleanup
    const remainingCollections = await getAllCollections(db);
    console.log(`\n🔍 [CLEANUP] Remaining collections: ${remainingCollections.length}`);
    
    if (remainingCollections.length === 0) {
      console.log('🎉 [CLEANUP] Database cleanup completed successfully!');
      console.log('✨ Your database is now completely clean and ready for fresh data.');
    } else {
      console.log('⚠️  [CLEANUP] Some collections may still exist:', remainingCollections);
    }
    
  } catch (error) {
    console.error('[CLEANUP] ❌ Error during cleanup:', error);
  } finally {
    // Close connection
    await mongoose.connection.close();
    console.log('[CLEANUP] Database connection closed.');
    process.exit(0);
  }
};

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n⚠️  [CLEANUP] Process interrupted. Closing database connection...');
  await mongoose.connection.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  [CLEANUP] Process terminated. Closing database connection...');
  await mongoose.connection.close();
  process.exit(0);
});

// Run the cleanup
if (require.main === module) {
  cleanupDatabase().catch(error => {
    console.error('[CLEANUP] ❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { cleanupDatabase, dropCollection, clearCollection };





