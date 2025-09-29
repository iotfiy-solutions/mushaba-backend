const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Connection = require('../models/Connection');
const Chat = require('../models/Chat');
const PinLocation = require('../models/PinLocation');

class WebSocketService {
  constructor() {
    console.log('[WEBSOCKET_DEBUG] WebSocketService constructor called');
    this.io = null;
    this.userSockets = new Map(); // userId -> socketId
    this.socketUsers = new Map(); // socketId -> userId
    this.userRooms = new Map(); // userId -> Set of roomIds
    this.roomUsers = new Map(); // roomId -> Set of userIds
    console.log('[WEBSOCKET_DEBUG] WebSocketService instance created');
  }

  // Static method to get service instance
  static getInstance() {
    if (!WebSocketService.instance) {
      console.log('[WEBSOCKET_DEBUG] Creating new WebSocketService instance');
      WebSocketService.instance = new WebSocketService();
    } else {
      console.log('[WEBSOCKET_DEBUG] Returning existing WebSocketService instance');
    }
    return WebSocketService.instance;
  }

  initialize(server) {
    const { Server } = require('socket.io');
    console.log('[WEBSOCKET_DEBUG] Initializing WebSocket service...');
    
    this.io = new Server(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      },
      transports: ['websocket', 'polling']
    });

    // Make io instance globally available for other modules
    global.io = this.io;
    console.log('[WEBSOCKET_DEBUG] IO instance created and set globally');

    console.log('[WEBSOCKET_DEBUG] Setting up middleware...');
    this.setupMiddleware();
    console.log('[WEBSOCKET_DEBUG] Setting up event handlers...');
    this.setupEventHandlers();
    
    console.log('[WEBSOCKET] Service initialized successfully');
    console.log('[WEBSOCKET_DEBUG] WebSocket service setup complete');
  }

  setupMiddleware() {
    console.log('[WEBSOCKET_DEBUG] Setting up authentication middleware...');
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        console.log(`[WEBSOCKET_DEBUG] Authenticating socket: ${socket.id}`);
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          console.log(`[WEBSOCKET_DEBUG] No token found in socket handshake`);
          return next(new Error('Authentication token required'));
        }

        console.log(`[WEBSOCKET_DEBUG] Token found, verifying...`);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log(`[WEBSOCKET_DEBUG] Token decoded for user: ${decoded.id}`);
        
        const user = await User.findById(decoded.id).select('_id name username profilePicture status');
        
        if (!user) {
          console.log(`[WEBSOCKET_DEBUG] User not found in database: ${decoded.id}`);
          return next(new Error('User not found'));
        }

        // Check if user has status field, if not, assume active (for backward compatibility)
        if (user.status && user.status !== 'active') {
          console.log(`[WEBSOCKET_DEBUG] User account not active: ${user.status}`);
          return next(new Error('User account is not active'));
        }

        socket.userId = user._id.toString();
        socket.user = user;
        console.log(`[WEBSOCKET_DEBUG] Authentication successful for user: ${socket.userId}`);
        next();
      } catch (error) {
        console.error('[WEBSOCKET] Authentication error:', error.message);
        console.log(`[WEBSOCKET_DEBUG] Authentication error details:`, {
          socketId: socket.id,
          error: error.message,
          stack: error.stack
        });
        next(new Error('Authentication failed'));
      }
    });
    console.log('[WEBSOCKET_DEBUG] Authentication middleware setup complete');
  }

  setupEventHandlers() {
    console.log('[WEBSOCKET_DEBUG] Setting up connection event handler...');
    this.io.on('connection', (socket) => {
      console.log(`[WEBSOCKET] User ${socket.userId} connected: ${socket.id}`);
      console.log(`[WEBSOCKET_DEBUG] Socket auth data:`, {
        userId: socket.userId,
        user: socket.user,
        socketId: socket.id
      });
      
      this.handleConnection(socket);
      this.setupSocketEvents(socket);
    });
    console.log('[WEBSOCKET_DEBUG] Connection event handler setup complete');
  }

  handleConnection(socket) {
    const userId = socket.userId;
    
    console.log(`[WEBSOCKET_DEBUG] Handling connection for user: ${userId}, socket: ${socket.id}`);
    
    // Store socket mapping
    this.userSockets.set(userId, socket.id);
    this.socketUsers.set(socket.id, userId);
    this.userRooms.set(userId, new Set());

    // Join user's personal room
    socket.join(`user:${userId}`);
    console.log(`[WEBSOCKET_DEBUG] User ${userId} joined personal room: user:${userId}`);

    // Emit connection status to user
    socket.emit('connected', {
      userId,
      socketId: socket.id,
      timestamp: new Date().toISOString()
    });

    // Update user's online status
    this.updateUserStatus(userId, true);
  }

  setupSocketEvents(socket) {
    const userId = socket.userId;
    console.log(`[WEBSOCKET_DEBUG] Setting up socket events for user: ${userId}, socket: ${socket.id}`);

    // Join connection room
    socket.on('joinConnection', async (data) => {
      try {
        console.log(`[WEBSOCKET_DEBUG] joinConnection event received from user ${userId}:`, data);
        const { connectionId } = data;
        
        if (!connectionId) {
          console.log(`[WEBSOCKET_DEBUG] Connection ID missing in joinConnection data`);
          socket.emit('error', { message: 'Connection ID required' });
          return;
        }

        // Verify user is part of the connection
        const connection = await Connection.findById(connectionId);
        if (!connection) {
          socket.emit('error', { message: 'Connection not found' });
          return;
        }

        const userInConnection = connection.users.find(
          user => user.userId.toString() === userId
        );

        if (!userInConnection) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // ? Improved room management - only leave if joining a different room
        const roomId = `connection:${connectionId}`;
        const userRooms = this.userRooms.get(userId) || new Set();
        
        // Check if user is already in this room
        if (userRooms.has(roomId)) {
          console.log(`[WEBSOCKET_DEBUG] User ${userId} already in room ${roomId}, skipping join`);
          socket.emit('joinedConnection', {
            connectionId,
            roomId,
            timestamp: new Date().toISOString(),
            alreadyJoined: true
          });
          return;
        }

        // Leave previous connection rooms (but not the one we're joining)
        userRooms.forEach(existingRoomId => {
          if (existingRoomId.startsWith('connection:') && existingRoomId !== roomId) {
            console.log(`[WEBSOCKET_DEBUG] Leaving previous room: ${existingRoomId}`);
            socket.leave(existingRoomId);
            this.removeUserFromRoom(userId, existingRoomId);
          }
        });

        // Join new connection room
        console.log(`[WEBSOCKET_DEBUG] Joining connection room: ${roomId}`);
        socket.join(roomId);
        this.addUserToRoom(userId, roomId);

        console.log(`[WEBSOCKET] User ${userId} joined connection room: ${roomId}`);

        socket.emit('joinedConnection', {
          connectionId,
          roomId,
          timestamp: new Date().toISOString()
        });

        // Notify other users in the connection
        socket.to(roomId).emit('userJoinedConnection', {
          userId,
          user: socket.user,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('[WEBSOCKET] Error joining connection:', error);
        socket.emit('error', { message: 'Failed to join connection' });
      }
    });

    // Join chat room
    socket.on('joinChat', async (data) => {
      try {
        console.log(`[WEBSOCKET_DEBUG] joinChat event received from user ${userId}:`, data);
        const { chatId } = data;
        
        if (!chatId) {
          console.log(`[WEBSOCKET_DEBUG] Chat ID missing in joinChat data`);
          socket.emit('error', { message: 'Chat ID required' });
          return;
        }

        // Verify user is part of the chat
        const chat = await Chat.findById(chatId);
        if (!chat) {
          socket.emit('error', { message: 'Chat not found' });
          return;
        }

        const userInChat = chat.participants.find(
          participant => participant.userId.toString() === userId
        );

        if (!userInChat) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Leave previous chat room if any
        const userRooms = this.userRooms.get(userId) || new Set();
        userRooms.forEach(roomId => {
          if (roomId.startsWith('chat:')) {
            socket.leave(roomId);
            this.removeUserFromRoom(userId, roomId);
          }
        });

        // Join new chat room
        const roomId = `chat:${chatId}`;
        console.log(`[WEBSOCKET_DEBUG] Joining chat room: ${roomId}`);
        socket.join(roomId);
        this.addUserToRoom(userId, roomId);

        console.log(`[WEBSOCKET] User ${userId} joined chat room: ${roomId}`);
        
        // Debug: Check if user is actually in the room
        const roomMembers = await io.in(roomId).fetchSockets();
        console.log(`[WEBSOCKET_DEBUG] Room ${roomId} now has ${roomMembers.length} members`);
        roomMembers.forEach(member => {
          console.log(`[WEBSOCKET_DEBUG] Room member: ${member.user?.id || 'unknown'}`);
        });

        socket.emit('joinedChat', {
          chatId,
          roomId,
          timestamp: new Date().toISOString()
        });

        // Notify other users in the chat
        socket.to(roomId).emit('userJoinedChat', {
          userId,
          user: socket.user,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('[WEBSOCKET] Error joining chat:', error);
        socket.emit('error', { message: 'Failed to join chat' });
      }
    });

    // Handle pin location events
    socket.on('pinLocationCreated', (data) => {
      const { connectionId, pinLocation } = data;
      if (connectionId) {
        socket.to(`connection:${connectionId}`).emit('pinLocationCreated', { pinLocation });
      }
    });

    socket.on('pinLocationUpdated', (data) => {
      const { connectionId, pinLocation } = data;
      if (connectionId) {
        socket.to(`connection:${connectionId}`).emit('pinLocationUpdated', { pinLocation });
      }
    });

    socket.on('pinLocationDeleted', (data) => {
      const { connectionId, pinLocationId } = data;
      if (connectionId) {
        socket.to(`connection:${connectionId}`).emit('pinLocationDeleted', { pinLocationId });
      }
    });

    // Handle bus/hotel marker events (legacy)
    socket.on('busHotelMarkerCreated', (data) => {
      const { connectionId, marker } = data;
      if (connectionId) {
        this.io.to(`connection:${connectionId}`).emit('busHotelMarkerCreated', { marker });
      }
    });

    socket.on('busHotelMarkerUpdated', (data) => {
      const { connectionId, marker } = data;
      if (connectionId) {
        this.io.to(`connection:${connectionId}`).emit('busHotelMarkerUpdated', { marker });
      }
    });

    socket.on('busHotelMarkerDeleted', (data) => {
      const { connectionId, markerId, markerType } = data;
      if (connectionId) {
        this.io.to(`connection:${connectionId}`).emit('busHotelMarkerDeleted', { markerId, markerType });
      }
    });

    // NEW: Enhanced location events
    socket.on('locationMarked', (data) => {
      const { connectionId, type, isPersonal, location } = data;
      if (connectionId) {
        this.io.to(`connection:${connectionId}`).emit('locationMarked', { 
          type, 
          isPersonal, 
          location 
        });
      }
    });

    socket.on('locationUpdated', (data) => {
      const { connectionId, type, isPersonal, location } = data;
      if (connectionId) {
        this.io.to(`connection:${connectionId}`).emit('locationUpdated', { 
          type, 
          isPersonal, 
          location 
        });
      }
    });

    socket.on('locationRemoved', (data) => {
      const { connectionId, type, isPersonal, locationId } = data;
      if (connectionId) {
        this.io.to(`connection:${connectionId}`).emit('locationRemoved', { 
          type, 
          isPersonal, 
          locationId 
        });
      }
    });

    // NEW: Bus and Hotel Location events
    socket.on('busHotelLocationUpdated', (data) => {
      const { connectionId, type, scope, userId, locationData, action } = data;
      if (connectionId) {
        console.warn('🚌 [WEBSOCKET] Bus/Hotel location update:', { type, scope, action, userId });
        this.io.to(`connection:${connectionId}`).emit('busHotelLocationUpdated', {
          type,
          scope,
          userId,
          locationData,
          action,
          timestamp: new Date().toISOString()
        });
      }
    });

    // NEW: Ownership transfer events
    socket.on('ownershipTransferred', (data) => {
      const { connectionId, newOwnerId, oldOwnerId, choices } = data;
      if (connectionId) {
        this.io.to(`connection:${connectionId}`).emit('ownershipTransferred', {
          newOwnerId,
          oldOwnerId,
          choices
        });
      }
    });

    socket.on('ownershipTransferComplete', (data) => {
      const { connectionId, choices } = data;
      if (connectionId) {
        this.io.to(`connection:${connectionId}`).emit('ownershipTransferComplete', {
          choices
        });
      }
    });

    // Handle typing indicators
    socket.on('typingStart', (data) => {
      const { chatId } = data;
      if (chatId) {
        socket.to(`chat:${chatId}`).emit('userTyping', {
          userId,
          user: socket.user,
          isTyping: true
        });
      }
    });

    socket.on('typingStop', (data) => {
      const { chatId } = data;
      if (chatId) {
        socket.to(`chat:${chatId}`).emit('userTyping', {
          userId,
          user: socket.user,
          isTyping: false
        });
      }
    });

    // Handle user status updates
    socket.on('updateStatus', (data) => {
      const { status } = data;
      this.updateUserStatus(userId, status);
      
      // Notify all connections the user is part of
      const userRooms = this.userRooms.get(userId) || new Set();
      userRooms.forEach(roomId => {
        if (roomId.startsWith('connection:')) {
          socket.to(roomId).emit('userStatusChanged', {
            userId,
            status,
            timestamp: new Date().toISOString()
          });
        }
      });
    });

    // Handle connection update requests
    socket.on('requestConnectionUpdate', async (data) => {
      try {
        const { connectionId } = data;
        
        if (!connectionId) {
          socket.emit('error', { message: 'Connection ID required' });
          return;
        }

        // Get updated connection data
        const connectionUpdateService = require('../services/connectionUpdateService');
        const connectionUsers = await connectionUpdateService.getConnectionUsersWithTimestamps(connectionId);
        
        socket.emit('connectionUpdateReceived', {
          connectionId,
          users: connectionUsers,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('[WEBSOCKET] Error handling connection update request:', error);
        socket.emit('error', { message: 'Failed to get connection update' });
      }
    });

    // Handle MainScreen-specific connection updates (separate from GroupChat)
    socket.on('mainscreenConnectionUpdate', async (data) => {
      try {
        const { connectionId, updateType, userData, timestamp } = data;
        
        console.warn(`[WEBSOCKET_MAINSCREEN] MainScreen connection update received from user ${userId}:`, {
          connectionId,
          updateType,
          userData: userData ? { id: userData.id || userData._id, name: userData.name } : null,
          timestamp
        });

        if (!connectionId) {
          socket.emit('error', { message: 'Connection ID required' });
          return;
        }

        // Verify user is part of the connection
        const connection = await Connection.findById(connectionId);
        if (!connection) {
          socket.emit('error', { message: 'Connection not found' });
          return;
        }

        const userInConnection = connection.users.find(
          user => user.userId.toString() === userId
        );

        if (!userInConnection) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Get updated connection data
        const connectionUpdateService = require('../services/connectionUpdateService');
        const connectionUsers = await connectionUpdateService.getConnectionUsersWithTimestamps(connectionId);
        
        // Broadcast MainScreen-specific update to all users in the connection
        socket.to(`connection:${connectionId}`).emit('mainscreenConnectionUpdated', {
          connectionId,
          updateType,
          userData,
          users: connectionUsers,
          timestamp: new Date().toISOString()
        });

        console.warn(`[WEBSOCKET_MAINSCREEN] MainScreen connection update broadcasted to connection:${connectionId}`);

      } catch (error) {
        console.error('[WEBSOCKET_MAINSCREEN] Error handling MainScreen connection update:', error);
        socket.emit('error', { message: 'Failed to process MainScreen connection update' });
      }
    });

    // ? Handle room membership verification with REAL Socket.io room testing
    socket.on('verifyRoomMembership', async (data) => {
      try {
        const { connectionId } = data;
        console.log(`[WEBSOCKET_DEBUG] Room verification request from user ${userId} for connection ${connectionId}`);
        
        if (!connectionId) {
          socket.emit('roomVerificationResponse', { inRoom: false, error: 'Connection ID required' });
          return;
        }

        const roomId = `connection:${connectionId}`;
        
        // ? REAL room membership test - check if socket is actually in the Socket.io room
        const roomMembers = await this.io.in(roomId).fetchSockets();
        const isActuallyInRoom = roomMembers.some(member => member.id === socket.id);
        
        // Also check our internal tracking
        const userRooms = this.userRooms.get(userId) || new Set();
        const isInInternalTracking = userRooms.has(roomId);
        
        console.log(`[WEBSOCKET_DEBUG] User ${userId} room verification result:`, {
          connectionId,
          roomId,
          isActuallyInRoom,
          isInInternalTracking,
          roomMemberCount: roomMembers.length,
          roomMembers: roomMembers.map(m => ({ id: m.id, userId: m.userId })),
          userRooms: Array.from(userRooms)
        });

        // If not actually in room, try to rejoin
        if (!isActuallyInRoom) {
          console.log(`[WEBSOCKET_DEBUG] User ${userId} not actually in room, attempting to rejoin`);
          try {
            // Verify user is part of the connection
            const connection = await Connection.findById(connectionId);
            if (connection) {
              const userInConnection = connection.users.find(
                user => user.userId.toString() === userId
              );

              if (userInConnection) {
                // Rejoin the room
                socket.join(roomId);
                this.addUserToRoom(userId, roomId);
                console.log(`[WEBSOCKET_DEBUG] User ${userId} successfully rejoined room ${roomId}`);
                
                // Notify other users
                socket.to(roomId).emit('userJoinedConnection', {
                  userId,
                  user: socket.user,
                  timestamp: new Date().toISOString()
                });
                
                // Send success response
                socket.emit('roomVerificationResponse', {
                  connectionId,
                  roomId,
                  inRoom: true,
                  rejoined: true,
                  timestamp: new Date().toISOString()
                });
                return;
              } else {
                console.log(`[WEBSOCKET_DEBUG] User ${userId} not authorized for connection ${connectionId}`);
                socket.emit('roomVerificationResponse', { 
                  connectionId,
                  roomId,
                  inRoom: false, 
                  error: 'Not authorized for this connection' 
                });
                return;
              }
            } else {
              console.log(`[WEBSOCKET_DEBUG] Connection ${connectionId} not found`);
              socket.emit('roomVerificationResponse', { 
                connectionId,
                roomId,
                inRoom: false, 
                error: 'Connection not found' 
              });
              return;
            }
          } catch (rejoinError) {
            console.error('[WEBSOCKET_DEBUG] Error rejoining room:', rejoinError);
            socket.emit('roomVerificationResponse', { 
              connectionId,
              roomId,
              inRoom: false, 
              error: 'Rejoin failed' 
            });
            return;
          }
        }

        // User is actually in the room
        socket.emit('roomVerificationResponse', {
          connectionId,
          roomId,
          inRoom: true,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error('[WEBSOCKET_DEBUG] Error verifying room membership:', error);
        socket.emit('roomVerificationResponse', { inRoom: false, error: 'Verification failed' });
      }
    });

    // ? Handle room membership test - send a test message to verify actual message delivery
    socket.on('testRoomMembership', async (data) => {
      try {
        const { connectionId } = data;
        console.log(`[WEBSOCKET_DEBUG] Room membership test request from user ${userId} for connection ${connectionId}`);
        
        if (!connectionId) {
          socket.emit('roomTestResponse', { received: false, error: 'Connection ID required' });
          return;
        }

        const roomId = `connection:${connectionId}`;
        
        // Send a test message to the room and see if the user receives it
        const testMessage = {
          type: 'roomMembershipTest',
          from: 'server',
          timestamp: new Date().toISOString(),
          testId: `test_${Date.now()}_${userId}`
        };
        
        console.log(`[WEBSOCKET_DEBUG] Sending test message to room ${roomId}:`, testMessage);
        
        // Send test message to the room
        this.io.to(roomId).emit('roomMembershipTest', testMessage);
        
        // Also send direct response to the requesting socket
        socket.emit('roomTestResponse', {
          received: true,
          testId: testMessage.testId,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error('[WEBSOCKET_DEBUG] Error testing room membership:', error);
        socket.emit('roomTestResponse', { received: false, error: 'Test failed' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`[WEBSOCKET] User ${userId} disconnected: ${socket.id}`);
      console.log(`[WEBSOCKET_DEBUG] Disconnecting user ${userId} from socket ${socket.id}`);
      this.handleDisconnection(socket);
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`[WEBSOCKET] Socket error for user ${userId}:`, error);
      console.log(`[WEBSOCKET_DEBUG] Socket error details:`, {
        userId,
        socketId: socket.id,
        error: error.message,
        stack: error.stack
      });
    });
    
    console.log(`[WEBSOCKET_DEBUG] Socket events setup complete for user: ${userId}, socket: ${socket.id}`);
  }

  handleDisconnection(socket) {
    const userId = socket.userId;
    
    console.log(`[WEBSOCKET_DEBUG] Handling disconnection for user: ${userId}, socket: ${socket.id}`);
    
    // Remove socket mappings
    this.userSockets.delete(userId);
    this.socketUsers.delete(socket.id);
    console.log(`[WEBSOCKET_DEBUG] Socket mappings removed for user: ${userId}`);
    
    // Leave all rooms
    const userRooms = this.userRooms.get(userId) || new Set();
    console.log(`[WEBSOCKET_DEBUG] User ${userId} was in ${userRooms.size} rooms`);
    userRooms.forEach(roomId => {
      this.removeUserFromRoom(userId, roomId);
    });
    this.userRooms.delete(userId);

    // Update user's online status
    this.updateUserStatus(userId, false);

    // Notify other users in the same rooms
    userRooms.forEach(roomId => {
      socket.to(roomId).emit('userDisconnected', {
        userId,
        timestamp: new Date().toISOString()
      });
    });
  }

  addUserToRoom(userId, roomId) {
    console.log(`[WEBSOCKET_DEBUG] Adding user ${userId} to room ${roomId}`);
    if (!this.roomUsers.has(roomId)) {
      this.roomUsers.set(roomId, new Set());
    }
    this.roomUsers.get(roomId).add(userId);

    if (!this.userRooms.has(userId)) {
      this.userRooms.set(userId, new Set());
    }
    this.userRooms.get(userId).add(roomId);
    console.log(`[WEBSOCKET_DEBUG] User ${userId} added to room ${roomId}. Room now has ${this.roomUsers.get(roomId).size} users`);
  }

  removeUserFromRoom(userId, roomId) {
    console.log(`[WEBSOCKET_DEBUG] Removing user ${userId} from room ${roomId}`);
    if (this.roomUsers.has(roomId)) {
      this.roomUsers.get(roomId).delete(userId);
      if (this.roomUsers.get(roomId).size === 0) {
        this.roomUsers.delete(roomId);
        console.log(`[WEBSOCKET_DEBUG] Room ${roomId} deleted (no users left)`);
      }
    }

    if (this.userRooms.has(userId)) {
      this.userRooms.get(userId).delete(roomId);
      if (this.userRooms.get(userId).size === 0) {
        this.userRooms.delete(userId);
        console.log(`[WEBSOCKET_DEBUG] User ${userId} removed from all rooms`);
      }
    }
  }

  async updateUserStatus(userId, isOnline) {
    try {
      console.log(`[WEBSOCKET_DEBUG] Updating user ${userId} status to: ${isOnline ? 'online' : 'offline'}`);
      
      // Update user's online status in database
      // Use $setOnInsert to add status field if it doesn't exist
      await User.findByIdAndUpdate(userId, {
        $set: {
          lastSeen: new Date()
        },
        $setOnInsert: {
          status: 'active'
        }
      }, {
        upsert: false,
        new: true
      });
      
      // Update online/offline status separately to avoid overwriting 'active' status
      if (isOnline) {
        await User.findByIdAndUpdate(userId, {
          $set: { lastSeen: new Date() }
        });
      }

      // Update connection locations if user is in any connection
      const connections = await Connection.find({
        'users.userId': userId,
        'users.status': 'active'
      });

      for (const connection of connections) {
        const userInConnection = connection.users.find(
          user => user.userId.toString() === userId
        );

        if (userInConnection) {
          // Update connection location status
          const { ConnectionLocation } = require('../models/Location');
          if (ConnectionLocation) {
            await ConnectionLocation.findOneAndUpdate(
              { connectionId: connection._id, 'users.userId': userId },
              {
                $set: {
                  'users.$.currentLocation.online': isOnline,
                  'users.$.currentLocation.lastUpdated': new Date()
                }
              },
              { upsert: false }
            );
          }
        }
      }
    } catch (error) {
      console.error('[WEBSOCKET] Error updating user status:', error);
    }
  }

  // Public methods for emitting events from other parts of the application
  emitToUser(userId, event, data) {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      console.log(`[WEBSOCKET] Emitting ${event} to user socket: ${socketId}`);
      this.io.to(socketId).emit(event, data);
    } else {
      console.log(`[WEBSOCKET] User ${userId} not found in socket mapping`);
    }
  }

  emitToConnection(connectionId, event, data) {
    console.log(`[WEBSOCKET] Emitting ${event} to connection room: connection:${connectionId}`);
    this.io.to(`connection:${connectionId}`).emit(event, data);
  }

  emitToChat(chatId, event, data) {
    console.log(`[WEBSOCKET] Emitting ${event} to chat room: chat:${chatId}`);
    this.io.to(`chat:${chatId}`).emit(event, data);
  }

  emitToRoom(roomId, event, data) {
    console.log(`[WEBSOCKET] Emitting ${event} to room: ${roomId}`);
    this.io.to(roomId).emit(event, data);
  }

  // NEW: Notification-specific methods for real-time delivery
  emitNotificationToUser(userId, notification) {
    try {
      console.log(`[WEBSOCKET] Attempting to emit notification to user: ${userId}`, {
        ioExists: !!this.io,
        roomId: `user:${userId}`,
        notificationType: notification.type
      });
      console.log(`[WEBSOCKET] Emitting to room: user:${userId}`);
      
      this.io.to(`user:${userId}`).emit('newNotification', {
        notification,
        timestamp: new Date().toISOString()
      });
      console.log(`[WEBSOCKET] Notification emitted to user: ${userId}`);
    } catch (error) {
      console.error('[WEBSOCKET] Error emitting notification to user:', error);
    }
  }

  emitNotificationToConnection(connectionId, notification, excludeUserId = null) {
    try {
      const roomId = `connection:${connectionId}`;
      console.log(`[WEBSOCKET] Emitting connection notification to room: ${roomId}`);
      if (excludeUserId) {
        // Emit to all users in connection except the excluded user
        this.io.to(roomId).emit('connectionNotification', {
          notification,
          timestamp: new Date().toISOString()
        });
      } else {
        // Emit to all users in connection
        this.io.to(roomId).emit('connectionNotification', {
          notification,
          timestamp: new Date().toISOString()
        });
      }
      console.log(`[WEBSOCKET] Connection notification emitted to room: ${roomId}`);
    } catch (error) {
      console.error('[WEBSOCKET] Error emitting connection notification:', error);
    }
  }

  // Get service status
  getStatus() {
    const status = {
      totalConnections: this.io.engine.clientsCount,
      totalUsers: this.userSockets.size,
      totalRooms: this.roomUsers.size,
      userRooms: Object.fromEntries(
        Array.from(this.userRooms.entries()).map(([userId, rooms]) => [
          userId,
          Array.from(rooms)
        ])
      ),
      roomUsers: Object.fromEntries(
        Array.from(this.roomUsers.entries()).map(([roomId, users]) => [
          roomId,
          Array.from(users)
        ])
      )
    };
    console.log('[WEBSOCKET_DEBUG] Service status:', status);
    return status;
  }

  // Broadcast to all connected users
  broadcast(event, data) {
    console.log(`[WEBSOCKET] Broadcasting ${event} to all users`);
    this.io.emit(event, data);
  }
}

console.log('[WEBSOCKET_DEBUG] Creating WebSocketService instance for module export');
const webSocketService = new WebSocketService();
console.log('[WEBSOCKET_DEBUG] WebSocketService instance created and exported');
module.exports = webSocketService;
