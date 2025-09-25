const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mushaba', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const Chat = require('../models/Chat');
const Connection = require('../models/Connection');
const User = require('../models/User');

async function debugChatIssue() {
  try {
    console.log('🔍 Debugging Chat Issue...\n');
    
    // Test 1: Check all connections
    console.log('1️⃣ Checking all connections...');
    const connections = await Connection.find({}).populate('users.userId', 'name username');
    console.log(`Found ${connections.length} connections`);
    
    connections.forEach((conn, index) => {
      console.log(`   Connection ${index + 1}: ${conn._id}`);
      console.log(`   Users: ${conn.users.map(u => u.userId.name).join(', ')}`);
    });
    
    // Test 2: Check all group chats
    console.log('\n2️⃣ Checking all group chats...');
    const groupChats = await Chat.find({ type: 'group' });
    console.log(`Found ${groupChats.length} group chats`);
    
    groupChats.forEach((chat, index) => {
      console.log(`   Chat ${index + 1}: ${chat._id}`);
      console.log(`   ConnectionId: ${chat.metadata?.connectionId || 'MISSING'}`);
      console.log(`   Participants: ${chat.participants.length}`);
    });
    
    // Test 3: Check specific connectionId from logs
    const testConnectionId = '68b612e828022b31534091e9'; // From your logs
    console.log(`\n3️⃣ Testing specific connectionId: ${testConnectionId}`);
    
    const chat = await Chat.findOne({
      type: 'group',
      'metadata.connectionId': testConnectionId
    });
    
    if (chat) {
      console.log(`✅ Found chat: ${chat._id}`);
      console.log(`   Participants: ${chat.participants.length}`);
    } else {
      console.log(`❌ No chat found for connectionId: ${testConnectionId}`);
      
      // Check if connection exists
      const connection = await Connection.findById(testConnectionId);
      if (connection) {
        console.log(`   But connection exists with ${connection.users.length} users`);
      } else {
        console.log(`   Connection also doesn't exist`);
      }
    }
    
    console.log('\n🎯 Debug complete!');
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    mongoose.connection.close();
  }
}

debugChatIssue();
