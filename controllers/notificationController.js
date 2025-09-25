const Notification = require('../models/Notification');
const mongoose = require('mongoose');

// Get all notifications for current user
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    const notifications = await Notification.find({ userId: new mongoose.Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    
    res.json({
      success: true,
      notifications
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications',
      error: error.message
    });
  }
};

// Mark notification as read
const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    const notification = await Notification.findOneAndUpdate(
      { 
        _id: new mongoose.Types.ObjectId(notificationId), 
        userId: new mongoose.Types.ObjectId(userId) 
      },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      notification
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking notification as read',
      error: error.message
    });
  }
};

// Mark all notifications as read
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID'
      });
    }

    await Notification.updateMany(
      { 
        userId: new mongoose.Types.ObjectId(userId), 
        read: false 
      },
      { read: true }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking all notifications as read',
      error: error.message
    });
  }
};

// Create notification (internal use) - ENHANCED with real-time delivery
const createNotification = async (userId, type, message, data = {}) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('[NOTIFICATION_DEBUG] Invalid user ID for notification:', userId);
      throw new Error('Invalid user ID');
    }

    console.log('[NOTIFICATION_DEBUG] Creating notification:', {
      userId,
      type,
      message,
      data
    });

    const notification = new Notification({
      userId: new mongoose.Types.ObjectId(userId),
      type,
      message,
      data,
      read: false,
      createdAt: new Date()
    });

    const savedNotification = await notification.save();
    console.log('[NOTIFICATION_DEBUG] Notification saved successfully:', savedNotification._id);

    // ENHANCED: Emit socket event for real-time update using WebSocket service
    try {
      console.log('[NOTIFICATION_DEBUG] Attempting to emit real-time notification...');
      // Import WebSocket service directly
      const webSocketService = require('../services/websocketService');
      console.log('[NOTIFICATION_DEBUG] WebSocket service imported:', !!webSocketService);
      
      if (webSocketService && webSocketService.emitNotificationToUser) {
        console.log('[NOTIFICATION_DEBUG] Emitting real-time notification to user:', userId);
        console.log('[NOTIFICATION_DEBUG] WebSocket service methods available:', {
          emitNotificationToUser: !!webSocketService.emitNotificationToUser,
          emitNotificationToConnection: !!webSocketService.emitNotificationToConnection
        });
        
        // Emit to the specific user who should receive the notification
        webSocketService.emitNotificationToUser(userId, {
          _id: savedNotification._id,
          type: savedNotification.type,
          message: savedNotification.message,
          data: savedNotification.data,
          read: savedNotification.read,
          createdAt: savedNotification.createdAt
        });
        
        // If it's connection-related, also emit to connection room for other users
        if (data.connectionId) {
          console.log('[NOTIFICATION_DEBUG] Emitting connection notification to room:', data.connectionId);
          webSocketService.emitNotificationToConnection(data.connectionId, {
            _id: savedNotification._id,
            type: savedNotification.type,
            message: savedNotification.message,
            data: savedNotification.data,
            read: savedNotification.read,
            createdAt: savedNotification.createdAt
          }, userId); // Exclude the user who already got the direct notification
        }
        
        console.log('[NOTIFICATION_DEBUG] Real-time notification emitted successfully');
      } else {
        console.warn('[NOTIFICATION_DEBUG] WebSocket service not available for notification');
      }
    } catch (socketError) {
      console.error('[NOTIFICATION_DEBUG] Error emitting socket notification (non-critical):', socketError);
      console.log('[NOTIFICATION_DEBUG] Socket error details:', {
        error: socketError.message,
        stack: socketError.stack
      });
      // Don't throw error - notification was saved successfully
    }

    return savedNotification;
  } catch (error) {
    console.error('[NOTIFICATION_DEBUG] Error creating notification:', error);
    console.log('[NOTIFICATION_DEBUG] Error details:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  createNotification
}; 