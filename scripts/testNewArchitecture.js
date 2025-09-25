const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mushaba', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const Connection = require('../models/Connection');
const Chat = require('../models/Chat');
const User = require('../models/User');

async function testNewArchitecture() {
  try {
    console.log('🧪 Testing New Architecture...\n');

    // Test 1: Check if connections have associated group chats
    console.log('1️⃣ Checking connections and their group chats...');
    const connections = await Connection.find({}).populate('users.userId', 'name username');
    
    for (const connection of connections) {
      console.log(`\nConnection: ${connection._id}`);
      console.log(`Users: ${connection.users.map(u => u.userId.name).join(', ')}`);
      
      const groupChat = await Chat.findOne({
        type: 'group',
        'metadata.connectionId': connection._id
      });
      
      if (groupChat) {
        console.log(`✅ Group chat found: ${groupChat._id}`);
        console.log(`   Participants: ${groupChat.participants.map(p => p.userId).join(', ')}`);
      } else {
        console.log(`❌ No group chat found for this connection`);
      }
    }

    // Test 2: Check if all group chats have connectionId
    console.log('\n2️⃣ Checking if all group chats have connectionId...');
    const groupChats = await Chat.find({ type: 'group' });
    
    for (const chat of groupChats) {
      if (chat.metadata?.connectionId) {
        console.log(`✅ Chat ${chat._id} has connectionId: ${chat.metadata.connectionId}`);
      } else {
        console.log(`❌ Chat ${chat._id} missing connectionId`);
      }
    }

    // Test 3: Check for orphaned chats (chats without connections)
    console.log('\n3️⃣ Checking for orphaned chats...');
    const orphanedChats = await Chat.find({
      type: 'group',
      $or: [
        { 'metadata.connectionId': { $exists: false } },
        { 'metadata.connectionId': null }
      ]
    });
    
    if (orphanedChats.length === 0) {
      console.log('✅ No orphaned group chats found');
    } else {
      console.log(`❌ Found ${orphanedChats.length} orphaned group chats:`);
      orphanedChats.forEach(chat => console.log(`   - ${chat._id}`));
    }

    console.log('\n🎉 Architecture test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    mongoose.connection.close();
  }
}

testNewArchitecture();
