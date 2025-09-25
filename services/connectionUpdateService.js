const Connection = require('../models/Connection');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');

class ConnectionUpdateService {
  constructor() {
    console.log('[CONNECTION_UPDATE] Service initialized');
  }

  // Static method to get service instance
  static getInstance() {
    if (!ConnectionUpdateService.instance) {
      ConnectionUpdateService.instance = new ConnectionUpdateService();
    }
    return ConnectionUpdateService.instance;
  }

  // Update user's joinedAt timestamp when they join a connection
  async updateUserJoinTimestamp(connectionId, userId) {
    try {
      console.log(`[CONNECTION_UPDATE] Updating join timestamp for user ${userId} in connection ${connectionId}`);
      
      const result = await Connection.updateOne(
        { 
          _id: connectionId,
          'users.userId': userId 
        },
        { 
          $set: { 
            'users.$.joinedAt': new Date() 
          } 
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`[CONNECTION_UPDATE] Join timestamp updated for user ${userId}`);
        return true;
      } else {
        console.log(`[CONNECTION_UPDATE] No changes made for user ${userId}`);
        return false;
      }
    } catch (error) {
      console.error('[CONNECTION_UPDATE] Error updating join timestamp:', error);
      return false;
    }
  }

  // Create system message when user joins connection
  async createJoinSystemMessage(connectionId, userId, userName) {
    try {
      console.log(`[CONNECTION_UPDATE] Creating join system message for user ${userName} in connection ${connectionId}`);
      
      // Find the correct chat for this connection
      const chat = await this.findChatForConnection(connectionId, userId);

      if (!chat) {
        console.log(`[CONNECTION_UPDATE] No chat found for connection ${connectionId}`);
        return null;
      }

      // Get user's join timestamp
      const joinTimestamp = await this.getUserJoinTimestamp(connectionId, userId);
      
      return await this.createSystemMessageInChat(chat._id, connectionId, userId, userName, 'user_joined', joinTimestamp);
    } catch (error) {
      console.error('[CONNECTION_UPDATE] Error creating join system message:', error);
      return null;
    }
  }

  // Helper function to create system messages
  async createSystemMessageInChat(chatId, connectionId, userId, userName, action, timestamp = null, removedBy = null) {
    try {
      let caption = '';
      let systemData = {
        userId: userId,
        userName: userName,
        timestamp: timestamp || new Date(),
        connectionId: connectionId
      };

      switch (action) {
        case 'user_joined':
          caption = `${userName} joined the connection`;
          break;
        case 'user_left':
          caption = `${userName} left the connection`;
          break;
        case 'user_removed':
          caption = `${userName} was removed from the connection`;
          if (removedBy) {
            systemData.removedBy = removedBy;
          }
          break;
        default:
          caption = 'System notification';
      }

      const systemMessage = new Message({
        chatId: chatId,
        sender: null, // System message has no sender
        type: 'system',
        content: {
          systemAction: action,
          systemData: systemData
        },
        metadata: {
          caption: caption,
          connectionId: connectionId
        },
        createdAt: timestamp || new Date()
      });

      await systemMessage.save();
      console.log(`[CONNECTION_UPDATE] System message created: ${systemMessage._id} with action: ${action}, timestamp: ${systemMessage.createdAt}`);
      
      return systemMessage;
    } catch (error) {
      console.error('[CONNECTION_UPDATE] Error creating system message:', error);
      return null;
    }
  }

  // Helper function to find the correct chat for a connection
  async findChatForConnection(connectionId, userId) {
    try {
      // First try to find chat with connectionId in metadata
      let chat = await Chat.findOne({
        'metadata.connectionId': connectionId,
        type: 'group'
      });

      if (chat) {
        console.log(`[CONNECTION_UPDATE] Found chat with connectionId in metadata: ${chat._id}`);
        return chat;
      }

      // If not found, try to find any group chat where the user is a participant
      chat = await Chat.findOne({
        'participants.userId': userId,
        type: 'group'
      });

      if (chat) {
        console.log(`[CONNECTION_UPDATE] Found fallback chat for user: ${chat._id}`);
        // Update the chat metadata to include connectionId for future use
        await Chat.updateOne(
          { _id: chat._id },
          { $set: { 'metadata.connectionId': connectionId } }
        );
        console.log(`[CONNECTION_UPDATE] Updated chat metadata with connectionId: ${connectionId}`);
        return chat;
      }

      console.log(`[CONNECTION_UPDATE] No chat found for connection ${connectionId} and user ${userId}`);
      return null;
    } catch (error) {
      console.error('[CONNECTION_UPDATE] Error finding chat for connection:', error);
      return null;
    }
  }

  // Create system message when user leaves connection
  async createLeaveSystemMessage(connectionId, userId, userName) {
    try {
      console.log(`[CONNECTION_UPDATE] Creating leave system message for user ${userName} in connection ${connectionId}`);
      
      // Find the correct chat for this connection
      const chat = await this.findChatForConnection(connectionId, userId);
      
      if (!chat) {
        console.log(`[CONNECTION_UPDATE] No chat found for connection ${connectionId}`);
        return null;
      }

      return await this.createSystemMessageInChat(chat._id, connectionId, userId, userName, 'user_left');
    } catch (error) {
      console.error('[CONNECTION_UPDATE] Error creating leave system message:', error);
      return null;
    }
  }

  // Create system message when user is removed from connection
  async createRemoveSystemMessage(connectionId, userId, userName, removedBy) {
    try {
      console.log(`[CONNECTION_UPDATE] Creating remove system message for user ${userName} in connection ${connectionId}`);
      
      // Find the correct chat for this connection
      const chat = await this.findChatForConnection(connectionId, userId);
      
      if (!chat) {
        console.log(`[CONNECTION_UPDATE] No chat found for connection ${connectionId}`);
        return null;
      }

      return await this.createSystemMessageInChat(chat._id, connectionId, userId, userName, 'user_removed', null, removedBy);
    } catch (error) {
      console.error('[CONNECTION_UPDATE] Error creating remove system message:', error);
      return null;
    }
  }

  // Get user's join timestamp for message filtering
  async getUserJoinTimestamp(connectionId, userId) {
    try {
      console.log(`[CONNECTION_UPDATE] Getting join timestamp for user ${userId} in connection ${connectionId}`);
      
      const connection = await Connection.findById(connectionId);
      if (!connection) {
        console.log(`[CONNECTION_UPDATE] Connection not found: ${connectionId}`);
        return null;
      }

      const userRecord = connection.users.find(
        user => user.userId.toString() === userId.toString()
      );

      if (!userRecord) {
        console.log(`[CONNECTION_UPDATE] User ${userId} not found in connection ${connectionId}`);
        return null;
      }

      const joinTimestamp = userRecord.joinedAt || connection.metadata.createdAt;
      console.log(`[CONNECTION_UPDATE] User ${userId} join timestamp: ${joinTimestamp}`);
      console.log(`[CONNECTION_UPDATE] User record joinedAt: ${userRecord.joinedAt}`);
      console.log(`[CONNECTION_UPDATE] Connection metadata createdAt: ${connection.metadata.createdAt}`);
      
      return joinTimestamp;
    } catch (error) {
      console.error('[CONNECTION_UPDATE] Error getting user join timestamp:', error);
      return null;
    }
  }

  // Filter messages based on user's join timestamp
  async getFilteredMessages(chatId, userId, connectionId, page = 1, limit = 50) {
    try {
      console.log(`[CONNECTION_UPDATE] Getting filtered messages for user ${userId} in chat ${chatId}, connectionId: ${connectionId}`);
      
      // Get user's join timestamp
      const joinTimestamp = await this.getUserJoinTimestamp(connectionId, userId);
      
      if (!joinTimestamp) {
        console.log(`[CONNECTION_UPDATE] Could not determine join timestamp, returning all messages`);
        // Fallback: return all messages
        const messages = await Message.find({ chatId })
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .populate('sender', 'name username profilePicture')
          .populate('replyTo')
          .lean();
        
        console.log(`[CONNECTION_UPDATE] Fallback: returning ${messages.length} messages (no join timestamp)`);
        return messages;
      }

      console.log(`[CONNECTION_UPDATE] Filtering messages after: ${joinTimestamp}`);
      console.log(`[CONNECTION_UPDATE] Join timestamp type: ${typeof joinTimestamp}, value: ${joinTimestamp}`);
      
      // Get regular messages after user joined
      const regularMessages = await Message.find({
        chatId,
        type: { $ne: 'system' },
        createdAt: { $gte: joinTimestamp }
      })
        .sort({ createdAt: -1 })
        .populate('sender', 'name username profilePicture')
        .populate('replyTo')
        .lean();

      console.log(`[CONNECTION_UPDATE] Found ${regularMessages.length} regular messages after join timestamp ${joinTimestamp}`);

      // Get system messages that are relevant to this user
      // Include system messages for user join/leave events
      const systemMessages = await Message.find({
        chatId,
        type: 'system',
        $or: [
          // System messages after user joined
          { createdAt: { $gte: joinTimestamp } },
          // System messages for this specific user's join/leave events
          {
            'content.systemData.userId': userId
          }
        ]
      })
        .sort({ createdAt: -1 })
        .lean();

      console.log(`[CONNECTION_UPDATE] Found ${systemMessages.length} system messages for user ${userId}`);
      if (systemMessages.length > 0) {
        console.log(`[CONNECTION_UPDATE] System message examples:`, systemMessages.slice(0, 3).map(m => ({
          id: m._id,
          action: m.content?.systemAction,
          userId: m.content?.systemData?.userId,
          caption: m.metadata?.caption,
          createdAt: m.createdAt
        })));
      }

      // Combine and sort all messages by creation time
      const allMessages = [...regularMessages, ...systemMessages]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Apply pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + parseInt(limit);
      const paginatedMessages = allMessages.slice(startIndex, endIndex);

      console.log(`[CONNECTION_UPDATE] Found ${regularMessages.length} regular messages and ${systemMessages.length} system messages after join timestamp`);
      console.log(`[CONNECTION_UPDATE] Returning ${paginatedMessages.length} messages for page ${page}`);
      
      return paginatedMessages;
    } catch (error) {
      console.error('[CONNECTION_UPDATE] Error getting filtered messages:', error);
      return [];
    }
  }

  // Get connection users with join timestamps
  async getConnectionUsersWithTimestamps(connectionId) {
    try {
      const connection = await Connection.findById(connectionId)
        .populate('users.userId', 'name username profilePicture')
        .lean();

      if (!connection) {
        return [];
      }

      return connection.users.map(user => ({
        userId: user.userId._id,
        name: user.userId.name,
        username: user.userId.username,
        profilePicture: user.userId.profilePicture,
        role: user.role,
        status: user.status,
        joinedAt: user.joinedAt || connection.metadata.createdAt
      }));
    } catch (error) {
      console.error('[CONNECTION_UPDATE] Error getting connection users:', error);
      return [];
    }
  }
}

console.log('[CONNECTION_UPDATE] Creating ConnectionUpdateService instance for module export');
const connectionUpdateService = new ConnectionUpdateService();
console.log('[CONNECTION_UPDATE] ConnectionUpdateService instance created and exported');

module.exports = connectionUpdateService;
