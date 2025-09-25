const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Chat = require('../models/Chat');

// Load environment variables
dotenv.config();

async function migrateJoinTimestamp() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    // Find all chats that need joinTimestamp migration
    const chats = await Chat.find({
      $or: [
        { 'participants.joinTimestamp': { $exists: false } },
        { 'participants.0.joinTimestamp': { $exists: false } }
      ]
    });

    console.log(`Found ${chats.length} chats to migrate for joinTimestamp`);

    for (const chat of chats) {
      console.log(`Migrating joinTimestamp for chat ${chat._id} (type: ${chat.type})`);

      // Check if participants already have joinTimestamp
      const needsMigration = chat.participants.some(p => !p.joinTimestamp);
      
      if (!needsMigration) {
        console.log(`Chat ${chat._id} already has joinTimestamp, skipping`);
        continue;
      }

      // Update participants to add joinTimestamp
      const updatedParticipants = chat.participants.map(participant => ({
        ...participant.toObject(),
        joinTimestamp: participant.joinTimestamp || chat.createdAt || new Date()
      }));

      // Update the chat
      await Chat.findByIdAndUpdate(chat._id, {
        participants: updatedParticipants
      });

      console.log(`Migrated joinTimestamp for chat ${chat._id} with ${updatedParticipants.length} participants`);
    }

    console.log('JoinTimestamp migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  migrateJoinTimestamp();
}

module.exports = migrateJoinTimestamp; 