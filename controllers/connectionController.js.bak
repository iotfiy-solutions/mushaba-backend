const { createNotification } = require('./notificationController');
const ConnectionRequest = require('../models/ConnectionRequest');
const User = require('../models/User');
const Connection = require('../models/Connection');
const Notification = require('../models/Notification');
const ActivityLog = require('../models/ActivityLog');
const Message = require('../models/Message');
const mongoose = require('mongoose');

// Import connection update service for timestamp management and system messages
const connectionUpdateService = require('../services/connectionUpdateService');

// Import the WebSocket service for real-time notifications
console.log('[SOCKET_DEBUG] Importing WebSocket service...');
const webSocketService = require('../services/websocketService');
console.log('[SOCKET_DEBUG] WebSocket service imported:', !!webSocketService);
console.log('[SOCKET_DEBUG] WebSocket service methods:', {
  emitNotificationToUser: !!webSocketService?.emitNotificationToUser,
  emitNotificationToConnection: !!webSocketService?.emitNotificationToConnection
});

// Helper function to create activity log
const createActivityLog = async (connectionId, activityType, actor, target, message, metadata = {}) => {
  try {
    const activityLog = new ActivityLog({
      connectionId,
      activityType,
      actor,
      target,
      message,
      metadata
    });
    await activityLog.save();
  } catch (error) {
    console.error('Error creating activity log:', error);
  }
};

// Create a new connection or add member to existing connection
const createConnection = async (req, res) => {
  try {
    const { targetUserId, wantToJoin } = req.body;
    const currentUserId = req.user.id;

    console.log('=== CREATE CONNECTION START ===');
    console.log('Request body:', req.body);
    console.log('Current user ID:', currentUserId);
    console.log('Target user ID:', targetUserId);
    console.log('Want to join:', wantToJoin);

    console.log('Creating connection with:', {
      currentUserId,
      targetUserId,
      wantToJoin
    });

    // Validate user IDs
    if (!currentUserId || !targetUserId) {
      return res.status(400).json({ 
        success: false,
        message: 'Both user IDs are required' 
      });
    }

    // Check if user is trying to scan their own QR code
    if (currentUserId === targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot scan your own QR code'
      });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(currentUserId) || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // Check if users exist
    const [currentUser, targetUser] = await Promise.all([
      User.findById(currentUserId),
      User.findById(targetUserId)
    ]);

    if (!currentUser || !targetUser) {
      return res.status(404).json({
        success: false,
        message: 'One or both users not found' 
      });
    }

    try {
      // Get current user's active connection if any
      const currentUserConnection = await Connection.getUserActiveConnection(currentUserId);
      
      // If current user is in a connection, try to add target user to it
      if (currentUserConnection) {
        const currentUserInConnection = currentUserConnection.users.find(u => u.userId.toString() === currentUserId);
        
        if (currentUserInConnection) {
          // Check if target user is already in the connection
          const isTargetInConnection = currentUserConnection.users.some(
            u => u.userId.toString() === targetUserId
          );

          if (isTargetInConnection) {
            return res.status(400).json({
              success: false,
              message: 'User is already in this connection'
            });
          }

          // Check if target user is in any other connection
          const targetUserConnection = await Connection.getUserActiveConnection(targetUserId);
          if (targetUserConnection) {
            return res.status(400).json({
              success: false,
              message: 'User is already in another connection'
            });
          }

          // Add the target user to the existing connection
          currentUserConnection.users.push({
            userId: new mongoose.Types.ObjectId(targetUserId),
            role: 'member',
            status: 'active',
            addedBy: new mongoose.Types.ObjectId(currentUserId)
          });
          currentUserConnection.metadata.lastActivity = new Date();
          await currentUserConnection.save();

          // Update join timestamp and create system message
          await connectionUpdateService.updateUserJoinTimestamp(currentUserConnection._id, targetUserId);
          const systemMessage = await connectionUpdateService.createJoinSystemMessage(
            currentUserConnection._id, 
            targetUserId, 
            targetUser.name
          );

          // Add user to existing group chat
          try {
            const Chat = require('../models/Chat');
            const existingGroupChat = await Chat.findOne({
              type: 'group',
              'metadata.connectionId': currentUserConnection._id
            });
            
            if (existingGroupChat) {
              // Add user to existing group chat
              existingGroupChat.participants.push({
                userId: new mongoose.Types.ObjectId(targetUserId),
                role: 'member',
                status: 'active'
              });
              await existingGroupChat.save();
              console.log('User added to existing group chat:', targetUserId);
            }
          } catch (chatError) {
            console.error('Error adding user to group chat:', chatError);
            // Continue even if chat update fails
          }

          // Create notification for the new member
          await createNotification(
            targetUserId,
            'new_connection',
            `${currentUser.name} has added you to their connection`,
            { connectionId: currentUserConnection._id }
          );

          // Emit socket event for real-time updates
          if (req.app.get('io')) {
            const io = req.app.get('io');
            console.log('[SOCKET_DEBUG] IO instance available for newConnection:', !!io);
            console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
            
            // Emit to new user
            io.to(`user:${targetUserId}`).emit('newConnection', {
              connectionId: currentUserConnection._id,
              addedBy: currentUser.name
            });

            // Emit connection update to all existing connection members
            io.to(`connection:${currentUserConnection._id}`).emit('connectionUpdated', {
              type: 'user_joined',
              userId: targetUserId,
              userName: targetUser.name,
              userImage: targetUser.image, // ? Include user image
              connectionId: currentUserConnection._id,
              timestamp: new Date()
            });

            // Emit system message if created
            if (systemMessage) {
              io.to(`connection:${currentUserConnection._id}`).emit('newSystemMessage', {
                connectionId: currentUserConnection._id,
                message: systemMessage
              });
            }
          }

          // Create activity log
          await createActivityLog(
            currentUserConnection._id,
            'create_connection',
            { userId: currentUserId, name: currentUser.name },
            { userId: targetUserId, name: targetUser.name },
            `${currentUser.name} added ${targetUser.name} to the connection`
          );

          return res.status(200).json({
            success: true,
            message: 'User added to your existing connection',
            connection: {
              _id: currentUserConnection._id,
              users: currentUserConnection.users,
              status: currentUserConnection.metadata.status,
              metadata: currentUserConnection.metadata
            }
          });
        }
      }

      // Check if target user is in a connection
      const targetUserConnection = await Connection.getUserActiveConnection(targetUserId);
      if (targetUserConnection) {
      // Check if target user is in a connection and wantToJoin is not provided
      if (wantToJoin === undefined) {
        return res.status(200).json({
          success: true,
          message: 'This user is already in a connection. Do you want to join them?',
          requiresConfirmation: true,
          connection: {
            _id: targetUserConnection._id,
            users: targetUserConnection.users,
            status: targetUserConnection.metadata.status,
            metadata: targetUserConnection.metadata
          }
        });
      }

      // If user doesn't want to join, return early
      if (!wantToJoin) {
        return res.status(200).json({
          success: true,
          message: 'Operation cancelled by user',
          cancelled: true
        });
      }

      // If target user is in a connection and user wants to join, create a connection request
      const scannedUser = targetUserConnection.users.find(u => u.userId.toString() === targetUserId);
      if (!scannedUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found in connection'
        });
      }

      console.log('=== ABOUT TO CREATE CONNECTION REQUEST ===');
      console.log('Scanned user found:', scannedUser);
      console.log('Target user connection:', targetUserConnection._id);

      // Check for duplicate requests
      const existingRequest = await ConnectionRequest.findOne({
        requesterId: currentUserId,
        connectionId: targetUserConnection._id,
        status: { $in: ['pending', 'approved'] }
      });

      console.log('=== DUPLICATE REQUEST CHECK ===');
      console.log('Existing request found:', existingRequest);

      if (existingRequest) {
        console.log('=== DUPLICATE REQUEST DETECTED ===');
        console.log('Request status:', existingRequest.status);
        
        if (existingRequest.status === 'pending') {
          return res.status(400).json({
            success: false,
            message: 'You already have a pending request for this connection'
          });
        }
        
        if (existingRequest.status === 'approved') {
          // Check if the user is actually in the connection
          const isUserInConnection = targetUserConnection.users.some(
            u => u.userId.toString() === currentUserId && u.status === 'active'
          );
          
          console.log('=== CHECKING IF USER IS ACTUALLY IN CONNECTION ===');
          console.log('Is user in connection:', isUserInConnection);
          
          if (isUserInConnection) {
            return res.status(400).json({
              success: false,
              message: 'You are already a member of this connection'
            });
          } else {
            // User has an approved request but is not in connection (probably removed)
            // Delete the old approved request and allow them to create a new one
            console.log('=== DELETING OLD APPROVED REQUEST ===');
            await ConnectionRequest.deleteOne({ _id: existingRequest._id });
            console.log('Old approved request deleted');
          }
        }
      }

      console.log('=== NO DUPLICATE REQUEST FOUND ===');

      // Check for and delete any rejected requests
      await ConnectionRequest.deleteMany({
        requesterId: currentUserId,
        connectionId: targetUserConnection._id,
        status: 'rejected'
      });

      console.log('=== DELETED REJECTED REQUESTS ===');

      // Create connection request
      const connectionRequest = new ConnectionRequest({
        requesterId: currentUserId,
        connectionId: targetUserConnection._id,
        scannedUserId: targetUserId,
        approvals: [
          {
            userId: targetUserConnection.users.find(u => u.role === 'owner').userId,
            status: 'pending',
            role: 'owner'
          }
        ]
      });

      console.log('=== CONNECTION REQUEST OBJECT CREATED ===');
      console.log('Connection request data:', {
        requesterId: connectionRequest.requesterId,
        connectionId: connectionRequest.connectionId,
        scannedUserId: connectionRequest.scannedUserId,
        approvals: connectionRequest.approvals
      });

      // If scanned user is not the owner, add them to approvals
      if (scannedUser.role !== 'owner') {
        connectionRequest.approvals.push({
          userId: targetUserId,
          status: 'pending',
          role: 'member'
        });
        console.log('=== ADDED SCANNED USER TO APPROVALS ===');
      }

      try {
        console.log('Attempting to save connection request:', {
          requesterId: currentUserId,
          connectionId: targetUserConnection._id,
          scannedUserId: targetUserId,
          approvals: connectionRequest.approvals
        });
        
        await connectionRequest.save();
        console.log('Connection request saved successfully:', connectionRequest._id);
      } catch (saveError) {
        console.error('Error saving connection request:', saveError);
        
        // Check if it's a duplicate key error
        if (saveError.code === 11000) {
          return res.status(400).json({
            success: false,
            message: 'You already have a pending request for this connection'
          });
        }
        
        return res.status(400).json({
          success: false,
          message: 'Failed to create connection request',
          error: saveError.message
        });
      }

      // Create notifications only for owner and scanned member (NOT the requester)
      const owner = targetUserConnection.users.find(u => u.role === 'owner');
      
      // Send notification to owner with approval buttons (only if owner is not the requester)
      if (owner.userId.toString() !== currentUserId) {
        await createNotification(
          owner.userId,
          'connection_request',
          `${currentUser.name} wants to join your connection`,
          { 
            requestId: connectionRequest._id, 
            connectionId: targetUserConnection._id,
            requesterName: currentUser.name,
            type: 'approval',
            showButtons: true,
            isRequester: false
          }
        );
      }

      // Send notification to scanned member if they're not the owner and not the requester
      if (scannedUser.role !== 'owner' && scannedUser.userId.toString() !== currentUserId) {
        await createNotification(
          targetUserId,
          'connection_request',
          `${currentUser.name} wants to join your connection`,
          { 
            requestId: connectionRequest._id, 
            connectionId: targetUserConnection._id,
            requesterName: currentUser.name,
            type: 'approval',
            showButtons: true,
            isRequester: false
          }
        );
      }

      // Create a simple notification for the requester (no approval buttons)
      await createNotification(
        currentUserId,
        'request_sent',
        `Connection request sent to ${targetUser.name}'s connection`,
        { 
          requestId: connectionRequest._id, 
          connectionId: targetUserConnection._id,
          targetName: targetUser.name,
          type: 'info',
          showButtons: false,
          isRequester: true
        }
      );

      // Emit socket events
      if (req.app.get('io')) {
        const io = req.app.get('io');
        console.log('[SOCKET_DEBUG] IO instance available for connectionRequest:', !!io);
        console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
        // Send approval event to owner
        io.to(`user:${owner.userId}`).emit('connectionRequest', {
          requestId: connectionRequest._id,
          requester: currentUser.name,
          connectionId: targetUserConnection._id,
          type: 'approval',
          showButtons: true,
          isRequester: false
        });

        // Send approval event to scanned member if not owner
        if (scannedUser.role !== 'owner') {
          io.to(`user:${targetUserId}`).emit('connectionRequest', {
            requestId: connectionRequest._id,
            requester: currentUser.name,
            connectionId: targetUserConnection._id,
            type: 'approval',
            showButtons: true,
            isRequester: false
          });
        }

        // Send simple request sent event to requester
        io.to(`user:${currentUserId}`).emit('connectionRequest', {
          requestId: connectionRequest._id,
          targetName: targetUser.name,
          connectionId: targetUserConnection._id,
          type: 'info',
          showButtons: false,
          isRequester: true
        });
      }

      // Create activity log
      await createActivityLog(
        targetUserConnection._id,
        'scan_qr',
        { userId: currentUserId, name: currentUser.name },
        { userId: targetUserId, name: targetUser.name },
        `${currentUser.name} scanned ${targetUser.name}'s QR code`
      );

      return res.status(201).json({
        success: true,
        message: 'Connection request sent successfully',
        request: {
          _id: connectionRequest._id,
          status: connectionRequest.status,
          approvals: connectionRequest.approvals
        }
      });
    }

      // If neither user is in a connection, create a new connection
    const newConnection = new Connection({
      users: [
        {
          userId: new mongoose.Types.ObjectId(currentUserId),
          role: 'owner',
          status: 'active',
          addedBy: new mongoose.Types.ObjectId(currentUserId)
        },
        {
          userId: new mongoose.Types.ObjectId(targetUserId),
          role: 'member',
          status: 'active',
          addedBy: new mongoose.Types.ObjectId(currentUserId)
        }
      ],
      metadata: {
        createdAt: new Date(),
        lastActivity: new Date(),
        connectionType: 'qr',
        status: 'active'
      }
    });

    await newConnection.save();

    // Create group chat for the new connection
    try {
      const Chat = require('../models/Chat');
      const newGroupChat = new Chat({
        type: 'group',
        participants: [
          {
            userId: new mongoose.Types.ObjectId(currentUserId),
            role: 'owner',
            status: 'active'
          },
          {
            userId: new mongoose.Types.ObjectId(targetUserId),
            role: 'member',
            status: 'active'
          }
        ],
        metadata: {
          name: 'Group Chat',
          description: 'Group chat for connection',
          connectionId: newConnection._id
        }
      });
      
      await newGroupChat.save();
      console.log('Group chat created for new connection:', newGroupChat._id);
    } catch (chatError) {
      console.error('Error creating group chat:', chatError);
      // Continue even if chat creation fails
    }

    // Create notifications
    await createNotification(
      targetUserId,
      'new_connection',
      `${currentUser.name} has created a connection with you`,
      { connectionId: newConnection._id }
    );

    // Emit socket event for real-time updates
    if (req.app.get('io')) {
      const io = req.app.get('io');
      console.log('[SOCKET_DEBUG] IO instance available for newConnection (new):', !!io);
      console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
              io.to(`user:${targetUserId}`).emit('newConnection', {
        connectionId: newConnection._id,
        addedBy: currentUser.name
      });
    }

    // Create activity log
    await createActivityLog(
      newConnection._id,
      'create_connection',
      { userId: currentUserId, name: currentUser.name },
      { userId: targetUserId, name: targetUser.name },
      `${currentUser.name} created a connection with ${targetUser.name}`
    );

    return res.status(201).json({
      success: true,
      message: 'Connection created successfully',
      connection: {
        _id: newConnection._id,
        users: newConnection.users,
        status: newConnection.metadata.status,
        metadata: newConnection.metadata
      }
    });
    } catch (error) {
      console.error('Error in connection creation:', error);
      return res.status(400).json({
        success: false,
        message: error.message || 'Error creating connection'
      });
    }
  } catch (error) {
    console.error('Error creating connection:', error);
    
    // Check for duplicate request error
    if (error.message && error.message.includes('duplicate key error')) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending request for this connection'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating connection',
      error: error.message 
    });
  }
};

// Remove a user from connection
const removeUser = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { targetUserId } = req.body;
    const currentUserId = req.user.id;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(connectionId) || 
        !mongoose.Types.ObjectId.isValid(targetUserId) || 
        !mongoose.Types.ObjectId.isValid(currentUserId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid ID format' 
      });
    }

    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({ 
        success: false,
        message: 'Connection not found' 
      });
    }

    // Find the user to be removed
    const userToRemove = connection.users.find(u => u.userId.toString() === targetUserId);
    if (!userToRemove) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found in connection' 
      });
    }

    // Find the current user in the connection
    const currentUser = connection.users.find(u => u.userId.toString() === currentUserId);
    if (!currentUser) {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to perform this action' 
      });
    }

    // Check if current user is the owner
    if (currentUser.role !== 'owner') {
      return res.status(403).json({ 
        success: false,
        message: 'Only the owner can remove members' 
      });
    }

    // Check if trying to remove the owner
    if (userToRemove.role === 'owner') {
      return res.status(403).json({ 
        success: false,
        message: 'Cannot remove the owner of the connection' 
      });
    }

    // Remove the user from the connection
    connection.users = connection.users.filter(u => u.userId.toString() !== targetUserId);
    connection.metadata.lastActivity = new Date();

    // If no members left (only owner remains), delete the connection
    if (connection.users.length === 1 && connection.users[0].role === 'owner') {
      // Delete associated group chat
      try {
        const Chat = require('../models/Chat');
        const groupChat = await Chat.findOne({
          type: 'group',
          'metadata.connectionId': connectionId
        });
        
        if (groupChat) {
          await groupChat.deleteOne();
          console.log('Group chat deleted with connection:', groupChat._id);
        }
      } catch (chatError) {
        console.error('Error deleting group chat:', chatError);
        // Continue even if chat deletion fails
      }

      await connection.deleteOne();
      
      // Emit socket event for connection deletion
      if (req.app.get('io')) {
        const io = req.app.get('io');
        io.to(`user:${targetUserId}`).emit('connectionRemoved', {
          connectionId: connection._id
        });
      }

      // Create activity log
      await createActivityLog(
        connection._id,
        'remove_user',
        { userId: currentUserId, name: (await User.findById(currentUserId)).name },
        { userId: targetUserId, name: (await User.findById(targetUserId)).name },
        `${(await User.findById(currentUserId)).name} removed ${(await User.findById(targetUserId)).name} from the connection`
      );

      return res.json({
        success: true,
        message: 'Connection deleted as no members remain',
        connection: null
      });
    }

    await connection.save();

    // Remove user from associated group chat
    try {
      const Chat = require('../models/Chat');
      const groupChat = await Chat.findOne({
        type: 'group',
        'metadata.connectionId': connectionId
      });
      
      if (groupChat) {
        // Remove user from chat participants
        groupChat.participants = groupChat.participants.filter(
          p => p.userId.toString() !== targetUserId
        );
        await groupChat.save();
        console.log('User removed from group chat:', targetUserId);
      }
    } catch (chatError) {
      console.error('Error removing user from group chat:', chatError);
      // Continue even if chat update fails
    }

    // Look up users first (needed for notifications and system message)
    let removedUser, removingUser;
    try {
      removedUser = await User.findById(targetUserId);
      removingUser = await User.findById(currentUserId);
    } catch (userLookupError) {
      console.error('[DEBUG] Error looking up users:', userLookupError);
      return res.status(500).json({ 
        success: false,
        message: 'Error looking up user information',
        error: userLookupError.message 
      });
    }

    // Notify all remaining members about user being removed
    try {
      for (const member of connection.users) {
        try {
          await createNotification(
            member.userId,
            'user_removed',
            `${removingUser.name} removed ${removedUser.name} from the connection`,
            { 
              connectionId: connection._id,
              removedUserId: targetUserId,
              removedUserName: removedUser.name, // Add explicit userName field
              removedByUserId: currentUserId,
              removedByUserName: removingUser.name, // Add explicit userName field
              currentUserId: member.userId, // Add current user ID for frontend logic
              type: 'warning'
            }
          );
        } catch (notificationError) {
          console.error('[DEBUG] Error creating notification for member:', member.userId, notificationError);
        }
      }

      // Notify the removed user
      try {
        await createNotification(
          targetUserId,
          'user_removed',
          `You have been removed from the connection by ${removingUser.name}`,
          { 
            connectionId: connection._id,
            removedByUserId: currentUserId,
            removedByUserName: removingUser.name, // Add explicit userName field
            currentUserId: targetUserId, // Add current user ID for frontend logic
            type: 'error'
          }
        );
      } catch (notificationError) {
        console.error('[DEBUG] Error creating notification for removed user:', targetUserId, notificationError);
      }
    } catch (notificationError) {
      console.error('[DEBUG] Error creating notifications:', notificationError);
    }

    // Use new WebSocket service for real-time updates
    try {
      if (webSocketService && webSocketService.emitNotificationToUser) {
        console.log('[SOCKET_DEBUG] Emitting user_removed notifications via WebSocket service');
        // Emit user removed notification to all connection members
        for (const member of connection.users) {
          try {
            console.log('[SOCKET_DEBUG] Emitting to member:', member.userId.toString());
            webSocketService.emitNotificationToUser(member.userId.toString(), {
              type: 'user_removed',
              message: `${removingUser.name} removed ${removedUser.name} from the connection`,
              data: { 
                connectionId: connection._id,
                removedUserId: targetUserId,
                removedUserName: removedUser.name, // Add explicit userName field
                removedByUserId: currentUserId,
                removedByUserName: removingUser.name, // Add explicit userName field
                currentUserId: member.userId, // Add current user ID for frontend logic
                type: 'warning'
              }
            });
          } catch (wsError) {
            console.error('[DEBUG] Error emitting WebSocket notification to member:', member.userId, wsError);
          }
        }

        // Emit user removed notification to the removed user
        try {
          webSocketService.emitNotificationToUser(targetUserId.toString(), {
            type: 'user_removed',
            message: `You have been removed from the connection by ${removingUser.name}`,
            data: { 
              connectionId: connection._id,
              removedByUserId: currentUserId,
              removedByUserName: removingUser.name, // Add explicit userName field
              currentUserId: targetUserId, // Add current user ID for frontend logic
              type: 'error'
            }
          });
        } catch (wsError) {
          console.error('[DEBUG] Error emitting WebSocket notification to removed user:', targetUserId, wsError);
        }
      }
    } catch (wsServiceError) {
      console.error('[DEBUG] Error with WebSocket service:', wsServiceError);
    }

    // Emit socket event for real-time updates (keep for backward compatibility)
    try {
      if (req.app.get('io')) {
        const io = req.app.get('io');
        console.log('[SOCKET_DEBUG] IO instance available for backward compatibility:', !!io);
        console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
        
        // Emit to the removed user
        io.to(`user:${targetUserId}`).emit('userRemoved', {
          connectionId: connection._id,
          removedBy: currentUser.name
        });

        // Emit connection update to remaining members
        io.to(`connection:${connection._id}`).emit('connectionUpdated', {
          type: 'user_removed',
          userId: targetUserId,
          userName: removedUser.name,
          connectionId: connection._id,
          timestamp: new Date()
        });

        // Create and emit system message
        try {
          console.log('[DEBUG] Creating system message for user removal:', {
            connectionId: connection._id,
            chatId: connection.chatId,
            userId: targetUserId,
            userName: removedUser.name,
            removedBy: removingUser.name
          });
          
          const systemMessage = await connectionUpdateService.createRemoveSystemMessage(
            connection._id,
            targetUserId,
            removedUser.name,
            removingUser.name
          );
          
          if (systemMessage) {
            console.log('[DEBUG] System message created for user removal:', systemMessage._id);
            io.to(`connection:${connection._id}`).emit('newSystemMessage', {
              connectionId: connection._id,
              message: systemMessage
            });
            console.log('[DEBUG] newSystemMessage event emitted for user removal');
          }
        } catch (systemMessageError) {
          console.error('[DEBUG] Error creating system message for user removal:', systemMessageError);
          // Continue with the response even if system message creation fails
        }
      }
    } catch (socketError) {
      console.error('[DEBUG] Error emitting socket events:', socketError);
    }

    // Create activity log
    try {
      await createActivityLog(
        connection._id,
        'remove_user',
        { userId: currentUserId, name: removingUser.name },
        { userId: targetUserId, name: removedUser.name },
        `${removingUser.name} removed ${removedUser.name} from the connection`
      );
    } catch (activityLogError) {
      console.error('[DEBUG] Error creating activity log for user removal:', activityLogError);
      // Continue with the response even if activity log creation fails
    }

    res.json({
      success: true,
      message: 'User removed successfully',
      connection: {
        _id: connection._id,
        users: connection.users,
        status: connection.metadata.status,
        metadata: connection.metadata
      }
    });
  } catch (error) {
    console.error('Error removing user:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error removing user',
      error: error.message 
    });
  }
};

// Get a single connection by ID
const getConnection = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.user.id;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(connectionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid connection ID format'
      });
    }

    // Find the connection and populate user details
    const connection = await Connection.findById(connectionId)
      .populate('users.userId', 'name username profilePicture image status')
      .lean();

    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    // Check if user is part of the connection
    console.log('[DEBUG] Checking user access to connection:', {
      userId: userId,
      connectionId: connectionId,
      connectionUsers: connection.users.map(u => ({
        userId: u.userId._id.toString(),
        role: u.role,
        status: u.status
      }))
    });

    const userInConnection = connection.users.find(
      user => user.userId._id.toString() === userId
    );

    if (!userInConnection) {
      console.log('[DEBUG] User not found in connection:', {
        userId: userId,
        connectionId: connectionId,
        availableUsers: connection.users.map(u => u.userId._id.toString())
      });
      return res.status(403).json({
        success: false,
        message: 'Access denied - you are not part of this connection'
      });
    }

    console.log('[DEBUG] User access granted:', {
      userId: userId,
      connectionId: connectionId,
      userRole: userInConnection.role
    });

    res.json({
      success: true,
      connection
    });

  } catch (error) {
    console.error('Error fetching connection:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching connection'
    });
  }
};

// Get all connections for current user
const getConnections = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log('Fetching connections for user');

    const connections = await Connection.find({
      'users.userId': userId,
      'users.status': 'active'
    })
    .populate('users.userId', 'name username image qrCode')
    .sort({ 'metadata.lastActivity': -1 })
    .lean();

    console.log('Connections found:', connections.length);

    res.json({
      success: true,
      connections
    });
  } catch (error) {
    console.error('Error fetching connections:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching connections',
      error: error.message
    });
  }
};

// Remove a connection
const removeConnection = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.user.id;

    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    // Verify user is part of the connection
    const userInConnection = connection.users.find(u => u.userId.toString() === userId.toString());
    if (!userInConnection) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to remove this connection'
      });
    }

    // Get all user IDs for socket notification
    const userIds = connection.users.map(u => u.userId.toString());

    // Delete associated group chat
    try {
      const Chat = require('../models/Chat');
      const groupChat = await Chat.findOne({
        type: 'group',
        'metadata.connectionId': connectionId
      });
      
      if (groupChat) {
        await groupChat.deleteOne();
        console.log('Group chat deleted with connection:', groupChat._id);
      }
    } catch (chatError) {
      console.error('Error deleting group chat:', chatError);
      // Continue even if chat deletion fails
    }

    await connection.deleteOne();

    // Emit socket event for real-time updates
    if (req.app.get('io')) {
      const io = req.app.get('io');
      userIds.forEach(id => {
        io.to(`user:${id}`).emit('connectionRemoved', {
        connectionId: connection._id
        });
      });
    }

    res.status(200).json({
      success: true,
      message: 'Connection removed successfully'
    });
  } catch (error) {
    console.error('Error removing connection:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing connection',
      error: error.message
    });
  }
};

// Update connection status
const updateConnectionStatus = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    // Verify user is part of the connection
    const userInConnection = connection.users.find(u => u.userId.toString() === userId.toString());
    if (!userInConnection) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this connection'
      });
    }

    connection.metadata.status = status;
    connection.metadata.lastActivity = new Date();
    await connection.save();

    // Get all user IDs for socket notification
    const userIds = connection.users.map(u => u.userId.toString());

    // Emit socket event for real-time updates
    if (req.app.get('io')) {
      const io = req.app.get('io');
      userIds.forEach(id => {
        io.to(`user:${id}`).emit('connectionStatusUpdated', {
        connectionId: connection._id,
          status: connection.metadata.status
        });
      });
    }

    res.status(200).json({
      success: true,
      message: 'Connection status updated successfully',
      connection
    });
  } catch (error) {
    console.error('Error updating connection status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating connection status',
      error: error.message
    });
  }
};

// Handle connection request approval
const handleConnectionRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { action } = req.body; // 'approve' or 'reject'
    const userId = req.user.id;

    console.log('[DEBUG] handleConnectionRequest called with:', {
      requestId,
      action,
      userId,
      body: req.body,
      params: req.params
    });

    const request = await ConnectionRequest.findById(requestId)
      .populate('requesterId', 'name')
      .populate('connectionId');

    console.log('[DEBUG] ConnectionRequest.findById result:', {
      requestId,
      requestFound: !!request,
      request: request ? {
        _id: request._id,
        requesterId: request.requesterId,
        connectionId: request.connectionId,
        status: request.status
      } : null
    });

    if (!request) {
      console.log('[DEBUG] Connection request not found for ID:', requestId);
      return res.status(404).json({
        success: false,
        message: 'Connection request not found'
      });
    }

    // Check if request is already processed
    if (request.status === 'approved' || request.status === 'rejected') {
      console.log('[DEBUG] Request already processed:', requestId, 'Status:', request.status);
      
              // Even if already processed, send real-time notification to sender
        if (webSocketService && webSocketService.emitNotificationToUser) {
          console.log('[SOCKET_DEBUG] Emitting request_approved notification to user: ${request.requesterId}');
          console.log('[SOCKET_DEBUG] WebSocket service available:', !!webSocketService);
          console.log('[SOCKET_DEBUG] emitNotificationToUser method available:', !!webSocketService.emitNotificationToUser);
          if (request.status === 'approved') {
            webSocketService.emitNotificationToUser(request.requesterId.toString(), {
            type: 'request_approved',
            message: 'Your connection request has been approved',
            data: {
              connectionId: request.connectionId,
              type: 'success'
            }
          });
        } else if (request.status === 'rejected') {
          webSocketService.emitNotificationToUser(request.requesterId.toString(), {
            type: 'request_rejected',
            message: 'Your connection request has been rejected',
            data: {
              connectionId: request.connectionId,
              type: 'error'
            }
          });
        }
      }
      
      return res.status(400).json({
        success: false,
        message: `Connection request has already been ${request.status}`
      });
    }

    // Find the user's approval in the request
    const userApproval = request.approvals.find(a => a.userId.toString() === userId);
    if (!userApproval) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to handle this request'
      });
    }

    // Update the approval status
    userApproval.status = action === 'approve' ? 'approved' : 'rejected';
    request.metadata.lastActivity = new Date();

    // If any approval is received, process it immediately
    if (action === 'approve') {
      try {
        // Add user to connection
        const connection = await Connection.findById(request.connectionId);
        if (!connection) {
          throw new Error('Connection not found');
        }

        // Check if user is already in the connection
        const isUserAlreadyInConnection = connection.users.some(
          u => u.userId.toString() === request.requesterId.toString()
        );

        if (isUserAlreadyInConnection) {
          // If user is already in connection, just update the request status
          request.status = 'approved';
          await request.save();

          // Delete approval notifications for owner and scanned member only
          try {
            const approvalUserIds = request.approvals.map(a => a.userId.toString());
            await Notification.deleteMany({
              userId: { $in: approvalUserIds },
              'data.requestId': requestId.toString(),
              type: 'connection_request'
            });
          } catch (notifError) {
            console.error('Error deleting notifications:', notifError);
          }

          return res.json({
            success: true,
            message: 'User is already in the connection',
            connection: {
              _id: connection._id,
              users: connection.users,
              status: connection.metadata.status,
              metadata: connection.metadata
            }
          });
        }

        // If user is not in connection, add them
        connection.users.push({
          userId: request.requesterId,
          role: 'member',
          status: 'active',
          addedBy: userId
        });
        await connection.save();
        console.log('[DEBUG] User added to connection:', request.requesterId.toString());

        // Add user to existing group chat
        try {
          const Chat = require('../models/Chat');
          const existingGroupChat = await Chat.findOne({
            type: 'group',
            'metadata.connectionId': connection._id
          });
          
          if (existingGroupChat) {
            // Add user to existing group chat
            existingGroupChat.participants.push({
              userId: new mongoose.Types.ObjectId(request.requesterId),
              role: 'member',
              status: 'active'
            });
            await existingGroupChat.save();
            console.log('User added to existing group chat:', request.requesterId);
          }
        } catch (chatError) {
          console.error('Error adding user to group chat:', chatError);
          // Continue even if chat update fails
        }

        // Update join timestamp and create system message
        await connectionUpdateService.updateUserJoinTimestamp(connection._id, request.requesterId);
        const systemMessage = await connectionUpdateService.createJoinSystemMessage(
          connection._id, 
          request.requesterId, 
          request.requesterId.name
        );

        // Update request status to prevent duplicate processing
        request.status = 'approved';
        await request.save();
        console.log('[DEBUG] Marked request as approved:', requestId);

        // Delete ALL notifications related to this request (including request_sent)
        try {
          await Notification.deleteMany({
            $or: [
              { 'data.requestId': requestId.toString() },
              { 'data.requestId': requestId.toString(), type: 'connection_request' },
              { 'data.requestId': requestId.toString(), type: 'request_sent' }
            ]
          });
          console.log('[DEBUG] Deleted all notifications for request:', requestId);
        } catch (notifError) {
          console.error('Error deleting notifications:', notifError);
        }

        // Create success notification for requester
        await createNotification(
          request.requesterId,
          'request_approved',
          `Your connection request has been approved`,
          { 
            connectionId: connection._id,
            type: 'success'
          }
        );

        // Notify all connection members about new user joining (EXCLUDE the requester)
        const allMembers = connection.users.filter(u => u.userId.toString() !== request.requesterId.toString());
        for (const member of allMembers) {
          await createNotification(
            member.userId,
            'user_joined',
            `${request.requesterId.name} has joined your connection`,
            { 
              connectionId: connection._id,
              newUserId: request.requesterId,
              newUserName: request.requesterId.name, // Add explicit userName field
              type: 'info'
            }
          );
        }

        // Create activity log
        await createActivityLog(
          connection._id,
          'accept_request',
          { userId: userId, name: (await User.findById(userId)).name },
          { userId: request.requesterId, name: request.requesterId.name },
          `${(await User.findById(userId)).name} accepted ${request.requesterId.name}'s request to join the connection`
        );

        // Use new WebSocket service for real-time updates
        console.log('[DEBUG] WebSocket service check:', {
          webSocketServiceExists: !!webSocketService,
          emitMethodExists: !!(webSocketService && webSocketService.emitNotificationToUser),
          requesterId: request.requesterId.toString()
        });
        
        if (webSocketService && webSocketService.emitNotificationToUser) {
          console.log('[DEBUG] Emitting approval notification to requester:', request.requesterId.toString());
          // Emit approval notification to requester
          webSocketService.emitNotificationToUser(request.requesterId.toString(), {
            type: 'request_approved',
            message: `Your connection request has been approved`,
            data: { 
              connectionId: connection._id,
              type: 'success'
            }
          });

          // Emit user joined notification to all connection members
          for (const member of allMembers) {
            console.log('[DEBUG] Emitting user joined notification to member:', member.userId.toString());
            webSocketService.emitNotificationToUser(member.userId.toString(), {
              type: 'user_joined',
              message: `${request.requesterId.name} has joined your connection`,
              data: { 
                connectionId: connection._id,
                newUserId: request.requesterId,
                newUserName: request.requesterId.name, // Add explicit userName field
                type: 'info'
              }
            });
          }

          // Emit real-time connection updates
          if (req.app.get('io')) {
            const io = req.app.get('io');
            
            // Emit connection update to all connection members
            io.to(`connection:${connection._id}`).emit('connectionUpdated', {
              type: 'user_joined',
              userId: request.requesterId,
              userName: request.requesterId.name,
              userImage: request.requesterId.image, // ? Include user image
              connectionId: connection._id,
              timestamp: new Date()
            });

            // Emit system message if created
            if (systemMessage) {
              io.to(`connection:${connection._id}`).emit('newSystemMessage', {
                connectionId: connection._id,
                message: systemMessage
              });
            }
          }
        } else {
          console.warn('[DEBUG] WebSocket service not available for approval notifications');
        }

        // Emit socket events (keep for backward compatibility)
        if (req.app.get('io')) {
          const io = req.app.get('io');
          io.to(`user:${request.requesterId}`).emit('connectionRequestApproved', {
            requestId: request._id,
            connectionId: connection._id,
            type: 'success'
          });
        }

        return res.json({
          success: true,
          message: 'User added to connection successfully',
          connection: {
            _id: connection._id,
            users: connection.users,
            status: connection.metadata.status,
            metadata: connection.metadata
          }
        });
      } catch (error) {
        console.error('Error in approval process:', error);
        throw error;
      }
    } else {
      // If rejected, update request status to prevent duplicate processing
      request.status = 'rejected';
      await request.save();
      console.log('[DEBUG] Marked request as rejected:', requestId);

      // Delete ALL notifications related to this request (including request_sent)
      try {
        await Notification.deleteMany({
          $or: [
            { 'data.requestId': requestId.toString() },
            { 'data.requestId': requestId.toString(), type: 'connection_request' },
            { 'data.requestId': requestId.toString(), type: 'request_sent' }
          ]
        });
        console.log('[DEBUG] Deleted all notifications for request:', requestId);
      } catch (notifError) {
        console.error('Error deleting notifications:', notifError);
      }

      // Create rejection notification for requester
      await createNotification(
        request.requesterId,
        'request_rejected',
        `Your connection request has been rejected`,
        { 
          connectionId: request.connectionId,
          type: 'error'
        }
      );

             // Notify other connection members about the rejection
       const connection = await Connection.findById(request.connectionId);
       let otherMembers = [];
       if (connection) {
         otherMembers = connection.users.filter(u => u.userId.toString() !== userId.toString());
         for (const member of otherMembers) {
           await createNotification(
             member.userId,
             'request_rejected_other',
             `${(await User.findById(userId)).name} rejected ${request.requesterId.name}'s request to join the connection`,
             { 
               connectionId: request.connectionId,
               requesterName: request.requesterId.name,
               rejectedBy: (await User.findById(userId)).name,
               type: 'info'
             }
           );
         }
       }

       // Use new WebSocket service for real-time updates
       console.log('[DEBUG] WebSocket service check for rejection:', {
         webSocketServiceExists: !!webSocketService,
         emitMethodExists: !!(webSocketService && webSocketService.emitNotificationToUser),
         requesterId: request.requesterId.toString()
       });
       
       if (webSocketService && webSocketService.emitNotificationToUser) {
         console.log('[DEBUG] Emitting rejection notification to requester:', request.requesterId.toString());
         // Emit rejection notification to requester
         webSocketService.emitNotificationToUser(request.requesterId.toString(), {
           type: 'request_rejected',
           message: `Your connection request has been rejected`,
           data: { 
             connectionId: request.connectionId,
             type: 'error'
           }
         });

         // Emit rejection notification to other connection members
         if (connection && otherMembers.length > 0) {
           for (const member of otherMembers) {
             webSocketService.emitNotificationToUser(member.userId.toString(), {
               type: 'request_rejected_other',
               message: `${(await User.findById(userId)).name} rejected ${request.requesterId.name}'s request to join the connection`,
               data: { 
                 connectionId: request.connectionId,
                 requesterName: request.requesterId.name,
                 rejectedBy: (await User.findById(userId)).name,
                 type: 'info'
               }
             });
           }
         }
       } else {
         console.warn('[DEBUG] WebSocket service not available for rejection notifications');
       }

      // Emit socket events (keep for backward compatibility)
      if (req.app.get('io')) {
        const io = req.app.get('io');
        io.to(`user:${request.requesterId}`).emit('connectionRequestRejected', {
          requestId: request._id,
          type: 'error'
        });
      }

      return res.json({
        success: true,
        message: 'Connection request rejected'
      });
    }
  } catch (error) {
    console.error('Error handling connection request:', error);
    res.status(500).json({
      success: false,
      message: 'Error handling connection request',
      error: error.message
    });
  }
};

// Leave a connection
const leaveConnection = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.user.id;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(connectionId) || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid ID format' 
      });
    }

    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({ 
        success: false,
        message: 'Connection not found' 
      });
    }

    // Find the user in the connection
    const userInConnection = connection.users.find(u => u.userId.toString() === userId);
    if (!userInConnection) {
      return res.status(403).json({ 
        success: false,
        message: 'You are not part of this connection' 
      });
    }

    // Check if user is the owner
    if (userInConnection.role === 'owner') {
      return res.status(403).json({ 
        success: false,
        message: 'Owner cannot leave the connection. Transfer ownership or delete the connection instead.' 
      });
    }

    // Remove the user from the connection
    connection.users = connection.users.filter(u => u.userId.toString() !== userId);
    connection.metadata.lastActivity = new Date();

    // If no members left (only owner remains), delete the connection
    if (connection.users.length === 1 && connection.users[0].role === 'owner') {
      // Delete associated group chat
      try {
        const Chat = require('../models/Chat');
        const groupChat = await Chat.findOne({
          type: 'group',
          'metadata.connectionId': connectionId
        });
        
        if (groupChat) {
          await groupChat.deleteOne();
          console.log('Group chat deleted with connection:', groupChat._id);
        }
      } catch (chatError) {
        console.error('Error deleting group chat:', chatError);
        // Continue even if chat deletion fails
      }

      await connection.deleteOne();
      
      // Emit socket event for connection deletion
      if (req.app.get('io')) {
        const io = req.app.get('io');
        io.to(`user:${userId}`).emit('connectionRemoved', {
          connectionId: connection._id
        });
      }

      // Create activity log
      await createActivityLog(
        connection._id,
        'leave_connection',
        { userId: userId, name: (await User.findById(userId)).name },
        null,
        `${(await User.findById(userId)).name} left the connection`
      );

      return res.json({
        success: true,
        message: 'Connection deleted as no members remain',
        connection: null
      });
    }

    await connection.save();

    // Remove user from associated group chat
    try {
      const Chat = require('../models/Chat');
      const groupChat = await Chat.findOne({
        type: 'group',
        'metadata.connectionId': connectionId
      });
      
      if (groupChat) {
        // Remove user from chat participants
        groupChat.participants = groupChat.participants.filter(
          p => p.userId.toString() !== userId
        );
        await groupChat.save();
        console.log('User left group chat:', userId);
      }
    } catch (chatError) {
      console.error('Error removing user from group chat:', chatError);
      // Continue even if chat update fails
    }

    // Notify all remaining members about user leaving
    const leavingUser = await User.findById(userId);
    for (const member of connection.users) {
      await createNotification(
        member.userId,
        'user_left',
        `${leavingUser.name} has left the connection`,
        { 
          connectionId: connection._id,
          leftUserId: userId,
          type: 'info'
        }
      );
    }

    // Emit socket event for real-time updates
    if (req.app.get('io')) {
      const io = req.app.get('io');
      
      // Emit to the leaving user
      io.to(`user:${userId}`).emit('userRemoved', {
        connectionId: connection._id,
        removedBy: 'self'
      });

      // Emit connection update to remaining members
      io.to(`connection:${connection._id}`).emit('connectionUpdated', {
        type: 'user_left',
        userId: userId,
        userName: leavingUser.name,
        userImage: leavingUser.image, // ? Include user image
        connectionId: connection._id,
        timestamp: new Date()
      });

      // Create and emit system message
      console.log('[DEBUG] Creating system message for user leaving:', {
        connectionId: connection._id,
        chatId: connection.chatId,
        userId: userId,
        userName: leavingUser.name
      });
      
      const systemMessage = await connectionUpdateService.createLeaveSystemMessage(
        connection._id,
        userId,
        leavingUser.name
      );
      
      if (systemMessage) {
        console.log('[DEBUG] System message created:', systemMessage._id);
        io.to(`connection:${connection._id}`).emit('newSystemMessage', {
          connectionId: connection._id,
          message: systemMessage
        });
      }
    }

    // Create activity log
    await createActivityLog(
      connection._id,
      'leave_connection',
      { userId: userId, name: (await User.findById(userId)).name },
      null,
      `${(await User.findById(userId)).name} left the connection`
    );

    res.json({
      success: true,
      message: 'Left connection successfully',
      connection: {
        _id: connection._id,
        users: connection.users,
        status: connection.metadata.status,
        metadata: connection.metadata
      }
    });
  } catch (error) {
    console.error('Error leaving connection:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error leaving connection',
      error: error.message 
    });
  }
};

// Get activity logs for a connection
const getActivityLogs = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.user.id;

    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    // Check if user is part of the connection
    const userInConnection = connection.users.find(u => u.userId.toString() === userId);
    if (!userInConnection) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view activity logs'
      });
    }

    const logs = await ActivityLog.find({ connectionId })
      .populate('actor.userId', 'name')
      .populate('target.userId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching activity logs',
      error: error.message
    });
  }
};

module.exports = {
  createConnection,
  getConnection,
  removeUser,
  getConnections,
  removeConnection,
  updateConnectionStatus,
  handleConnectionRequest,
  leaveConnection,
  getActivityLogs
}; 