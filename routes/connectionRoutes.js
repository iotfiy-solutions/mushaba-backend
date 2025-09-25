const express = require('express');
const router = express.Router();
const connectionController = require('../controllers/connectionController');
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const mongoose = require('mongoose');
const Connection = require('../models/Connection');
const ActivityLog = require('../models/ActivityLog');
const Notification = require('../models/Notification');
const { createNotification } = require('../controllers/notificationController');

// All routes require authentication
router.use(protect);

// Create a new connection or add member to existing connection
router.post('/', connectionController.createConnection);

// Get all connections for current user
router.get('/', connectionController.getConnections);

// Get a single connection by ID
router.get('/:connectionId', connectionController.getConnection);

// Remove a user from connection
router.post('/:connectionId/remove', connectionController.removeUser);

// Leave a connection
router.post('/:connectionId/leave', connectionController.leaveConnection);

// Remove a connection
router.delete('/:connectionId', connectionController.removeConnection);

// Update connection status
router.patch('/:connectionId/status', connectionController.updateConnectionStatus);

// Handle connection request
router.post('/requests/:requestId', connectionController.handleConnectionRequest);

// Get activity logs for a connection
router.get('/:connectionId/logs', connectionController.getActivityLogs);

// Get connection users with timestamps (for real-time updates)
router.get('/:connectionId/users', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.user.id;

    // Check if user is part of the connection
    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    const userInConnection = connection.users.find(
      user => user.userId.toString() === userId
    );

    if (!userInConnection) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get connection users with timestamps
    const connectionUpdateService = require('../services/connectionUpdateService');
    const users = await connectionUpdateService.getConnectionUsersWithTimestamps(connectionId);

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('Error fetching connection users:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching connection users'
    });
  }
});

// Get user connections
router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('connections', 'name profilePicture status');

    res.json({
      success: true,
      connections: user.connections
    });
  } catch (error) {
    console.error('Error fetching connections:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching connections'
    });
  }
});

// Add connection
router.post('/:userId', async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentUser = await User.findById(req.user.id);
    if (currentUser.connections.includes(req.params.userId)) {
      return res.status(400).json({
        success: false,
        message: 'Already connected'
      });
    }

    // Add connection to both users
    currentUser.connections.push(req.params.userId);
    targetUser.connections.push(req.user.id);

    await currentUser.save();
    await targetUser.save();

          // Emit socket event for new connection
      const io = req.app.get('io');
      console.log('[SOCKET_DEBUG] IO instance available for newConnection (route):', !!io);
      console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
             io.to(`user:${req.params.userId}`).emit('newConnection', {
      userId: req.user.id,
      name: currentUser.name,
      profilePicture: currentUser.profilePicture
    });

    res.json({
      success: true,
      message: 'Connection added successfully'
    });
  } catch (error) {
    console.error('Error adding connection:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding connection'
    });
  }
});

// Remove connection
router.delete('/:userId', async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentUser = await User.findById(req.user.id);
    
    // Remove connection from both users
    currentUser.connections = currentUser.connections.filter(
      conn => conn.toString() !== req.params.userId
    );
    targetUser.connections = targetUser.connections.filter(
      conn => conn.toString() !== req.user.id
    );

    await currentUser.save();
    await targetUser.save();

          // Emit socket event for connection removal
      const io = req.app.get('io');
      console.log('[SOCKET_DEBUG] IO instance available for connectionRemoved (route):', !!io);
      console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
             io.to(`user:${req.params.userId}`).emit('connectionRemoved', {
      userId: req.user.id
    });

    res.json({
      success: true,
      message: 'Connection removed successfully'
    });
  } catch (error) {
    console.error('Error removing connection:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing connection'
    });
  }
});

// Transfer ownership
router.post('/:connectionId/transfer-ownership', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { newOwnerId, password } = req.body;
    const currentUserId = req.user.id;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(connectionId) || 
        !mongoose.Types.ObjectId.isValid(newOwnerId) || 
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

    // Find the current user in the connection
    const currentUser = connection.users.find(u => u.userId.toString() === currentUserId);
    if (!currentUser) {
      return res.status(403).json({ 
        success: false,
        message: 'Not authorized to perform this action' 
      });
    }

    // Find the new owner in the connection
    const newOwner = connection.users.find(u => u.userId.toString() === newOwnerId);
    if (!newOwner) {
      return res.status(404).json({ 
        success: false,
        message: 'New owner not found in connection' 
      });
    }

    // Verify current user's password
    const currentUserDoc = await User.findById(currentUserId).select('+password');
    if (!currentUserDoc) {
      return res.status(404).json({
        success: false,
        message: 'Current user not found'
      });
    }

    const isPasswordValid = await currentUserDoc.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid password' 
      });
    }

    // Update roles
    currentUser.role = 'member';
    newOwner.role = 'owner';
    connection.metadata.lastActivity = new Date();

    await connection.save();

    // Notify all connection members about ownership transfer
    const newOwnerDoc = await User.findById(newOwnerId);
    for (const member of connection.users) {
      await createNotification(
        member.userId,
        'ownership_transferred',
        `${currentUserDoc.name} transferred ownership to ${newOwnerDoc.name}`,
        { 
          connectionId: connection._id,
          newOwnerId: newOwnerId,
          newOwnerName: newOwnerDoc.name, // Add explicit userName field
          previousOwnerId: currentUserId,
          previousOwnerName: currentUserDoc.name, // Add explicit userName field
          type: 'info'
        }
      );
    }

    // Create activity log
    const activityLog = new ActivityLog({
      connectionId,
      activityType: 'transfer_ownership',
      actor: {
        userId: currentUserId,
        name: currentUserDoc.name
      },
      target: {
        userId: newOwnerId,
        name: (await User.findById(newOwnerId)).name
      },
      message: `${currentUserDoc.name} transferred ownership to ${(await User.findById(newOwnerId)).name}`
    });
    await activityLog.save();

    // Emit socket event for real-time updates
    if (req.app.get('io')) {
      const io = req.app.get('io');
              connection.users.forEach(user => {
          console.log('[SOCKET_DEBUG] IO instance available for ownershipTransferred:', !!io);
          console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
          io.to(`user:${user.userId}`).emit('ownershipTransferred', {
          connectionId: connection._id,
          newOwnerId: newOwnerId,
          previousOwnerId: currentUserId
        });
      });
    }

    res.json({
      success: true,
      message: 'Ownership transferred successfully',
      connection: {
        _id: connection._id,
        users: connection.users,
        status: connection.metadata.status,
        metadata: connection.metadata
      }
    });
  } catch (error) {
    console.error('Error transferring ownership:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error transferring ownership',
      error: error.message 
    });
  }
});

module.exports = router; 