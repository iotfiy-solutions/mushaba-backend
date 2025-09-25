const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Chat = require('../models/Chat');

// Load environment variables
dotenv.config();

async function migrateChats() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    // Find all chats with old participant structure (array of ObjectIds)
    const chats = await Chat.find({
      $or: [
        { participants: { $exists: true, $type: 'array' } },
        { 'participants.userId': { $exists: false } }
      ]
    });

    console.log(`Found ${chats.length} chats to migrate`);

    for (const chat of chats) {
      console.log(`Migrating chat ${chat._id} (type: ${chat.type})`);

      // Check if chat already has the new structure
      if (chat.participants.length > 0 && chat.participants[0].userId) {
        console.log(`Chat ${chat._id} already has new structure, skipping`);
        continue;
      }

      // Convert old structure (array of ObjectIds) to new structure
      const newParticipants = chat.participants.map((participantId, index) => ({
        userId: participantId,
        role: index === 0 ? 'owner' : 'member',
        status: 'active',
        joinTimestamp: new Date()
      }));

      // Update the chat
      await Chat.findByIdAndUpdate(chat._id, {
        participants: newParticipants
      });

      console.log(`Migrated chat ${chat._id} with ${newParticipants.length} participants`);
    }

    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  migrateChats();
}

module.exports = migrateChats; 