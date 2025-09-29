const PinLocation = require('../models/PinLocation');
const Connection = require('../models/Connection');
const Chat = require('../models/Chat');
const User = require('../models/User');
const Message = require('../models/Message');
const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');

// Helper function to create uploads directory
const createUploadsDirectory = async () => {
  const uploadsDir = path.join(__dirname, '../uploads/pin-locations');
  try {
    await fs.access(uploadsDir);
  } catch (error) {
    await fs.mkdir(uploadsDir, { recursive: true });
  }
};

// Create a new pin location
const createPinLocation = async (req, res) => {
  try {
    await createUploadsDirectory();

    const { 
      connectionId, 
      chatId, 
      type, 
      name, 
      latitude, 
      longitude, 
      comment, 
      icon 
    } = req.body;
    
    const userId = req.user.id;

    // Debug logging
    console.log('[CREATE_PIN_LOCATION] Request received:', {
      connectionId,
      chatId,
      type,
      name,
      latitude,
      longitude,
      comment,
      icon,
      userId,
      filesCount: req.files?.length || 0
    });

    // Validate required fields
    if (!connectionId || !chatId || !type || !name || !latitude || !longitude || !icon) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Validate images upload (only one image allowed)
    if (req.files && req.files.length > 1) {
      return res.status(400).json({
        success: false,
        message: 'Only 1 image allowed for pin locations'
      });
    }

    // Validate coordinates
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coordinates'
      });
    }

    // Check if connection exists and user is part of it
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
        message: 'Access denied - user not in connection'
      });
    }

    // Check if chat exists and user has access
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    const userInChat = chat.participants.find(
      participant => participant.userId.toString() === userId
    );

    if (!userInChat) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - user not in chat'
      });
    }

    // Create pin location object
    const pinLocationData = {
      userId,
      connectionId,
      chatId,
      type,
      name,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      comment: comment || '',
      images: req.files ? req.files.map(file => `/uploads/pin-locations/${file.filename}`) : [],
      icon,
      markedAt: new Date(),
      expiresAt: new Date(Date.now() + (48 * 60 * 60 * 1000)) // 48 hours from now
    };

    // Save pin location
    const pinLocation = new PinLocation(pinLocationData);
    await pinLocation.save();

    // Create chat message for the pin location
    const messageData = {
      chatId,
      sender: userId,
      type: 'customLocation',
      content: {
        name,
        coordinates: { latitude: parseFloat(latitude), longitude: parseFloat(longitude) },
        icon,
        comment: comment || '',
        images: req.files ? req.files.map(file => `/uploads/pin-locations/${file.filename}`) : [],
        pinLocationId: pinLocation._id
      },
      metadata: {
        pinLocationId: pinLocation._id,
        locationType: type
      }
    };

    const message = new Message(messageData);
    await message.save();

    // Update chat's last activity
    chat.lastActivity = new Date();
    chat.lastMessage = message._id;
    await chat.save();

    // Populate message for socket emission
    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name username profilePicture')
      .lean();

          // Emit WebSocket event for real-time updates
      const io = req.app.get('io');
      if (io) {
        console.log('[SOCKET_DEBUG] Emitting pin location message to room: chat:${chatId}');
        console.log('[SOCKET_DEBUG] IO instance available:', !!io);
        console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
        console.log('[SOCKET_DEBUG] Room to emit to: chat:${chatId}');
        io.to(`chat:${chatId}`).emit('newMessage', {
          type: 'customLocation',
          message: populatedMessage,
          pinLocation: {
            ...pinLocation.toObject(),
            imageUrls: req.files ? req.files.map(file => `/uploads/pin-locations/${file.filename}`) : []
          }
        });

        // Emit pin location update to map
        console.log('[SOCKET_DEBUG] Emitting pin location update to room: connection:${connectionId}');
        console.log('[SOCKET_DEBUG] IO instance available:', !!io);
        console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
        io.to(`connection:${connectionId}`).emit('pinLocationCreated', {
          pinLocation: {
            ...pinLocation.toObject(),
            imageUrls: req.files ? req.files.map(file => `/uploads/pin-locations/${file.filename}`) : []
          }
        });
      }

    res.json({
      success: true,
      message: 'Pin location created successfully',
      pinLocationId: pinLocation._id,
      imageUrls: req.files ? req.files.map(file => `/uploads/pin-locations/${file.filename}`) : [],
      pinLocation: {
        ...pinLocation.toObject(),
        imageUrls: req.files ? req.files.map(file => `/uploads/pin-locations/${file.filename}`) : []
      },
      chatMessage: populatedMessage
    });

  } catch (error) {
    console.error('[CREATE_PIN_LOCATION] Error:', error);
    
    // Clean up uploaded files if there was an error
    if (req.files && req.files.length > 0) {
      try {
        await Promise.all(req.files.map(file => fs.unlink(file.path)));
      } catch (unlinkError) {
        console.error('[CREATE_PIN_LOCATION] Error deleting files:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create pin location',
      error: error.message
    });
  }
};

// Get all active pin locations for a connection
const getPinLocations = async (req, res) => {
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

    // Get active pin locations
    const pinLocations = await PinLocation.getActivePinsForConnection(connectionId);

    // Add full image URLs
    const pinLocationsWithUrls = pinLocations.map(pin => ({
      ...pin.toObject(),
      images: pin.images.map(img => img.startsWith('/uploads/pin-locations/') ? img : `/uploads/pin-locations/${img}`)
    }));

    res.json({
      success: true,
      pinLocations: pinLocationsWithUrls,
      count: pinLocationsWithUrls.length
    });

  } catch (error) {
    console.error('[GET_PIN_LOCATIONS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pin locations'
    });
  }
};

// Get a specific pin location
const getPinLocation = async (req, res) => {
  try {
    const { pinId } = req.params;
    const userId = req.user.id;

    const pinLocation = await PinLocation.findById(pinId)
      .populate('userId', 'name username profilePicture')
      .populate('connectionId', 'name');

    if (!pinLocation) {
      return res.status(404).json({
        success: false,
        message: 'Pin location not found'
      });
    }

    // Check if user has access to this pin location
    const connection = await Connection.findById(pinLocation.connectionId);
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

    // Add full image URLs
    const pinLocationWithUrls = {
      ...pinLocation.toObject(),
      images: pinLocation.images.map(img => img.startsWith('/uploads/pin-locations/') ? img : `/uploads/pin-locations/${img}`)
    };

    res.json({
      success: true,
      pinLocation: pinLocationWithUrls
    });

  } catch (error) {
    console.error('[GET_PIN_LOCATION] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pin location'
    });
  }
};

// Update a pin location (partial updates supported)
const updatePinLocation = async (req, res) => {
  try {
    const { pinId } = req.params;
    const { 
      type, 
      name, 
      latitude, 
      longitude, 
      comment, 
      icon 
    } = req.body;
    
    const userId = req.user.id;

    console.log('[UPDATE_PIN_LOCATION] Request received:', {
      pinId,
      updates: req.body,
      userId,
      filesCount: req.files?.length || 0
    });
    
    // Debug multer configuration
    console.log('[UPDATE_PIN_LOCATION] Multer limits:', {
      fileSize: req.app.get('multer')?.limits?.fileSize || 'not set',
      files: req.files?.map(f => ({ filename: f.filename, size: f.size, mimetype: f.mimetype })) || []
    });

    // Find pin location
    const pinLocation = await PinLocation.findById(pinId);
    if (!pinLocation) {
      return res.status(404).json({
        success: false,
        message: 'Pin location not found'
      });
    }

    // Check ownership
    if (pinLocation.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - only creator can update'
      });
    }

    // Check if pin is expired
    if (pinLocation.isExpired()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot update expired pin location'
      });
    }

    // Prepare update object
    const updateData = {};
    if (type) updateData.type = type;
    if (name) updateData.name = name;
    if (latitude !== undefined) {
      if (latitude < -90 || latitude > 90) {
        return res.status(400).json({
          success: false,
          message: 'Invalid latitude'
        });
      }
      updateData.latitude = parseFloat(latitude);
    }
    if (longitude !== undefined) {
      if (longitude < -180 || longitude > 180) {
        return res.status(400).json({
          success: false,
          message: 'Invalid longitude'
        });
      }
      updateData.longitude = parseFloat(longitude);
    }
    if (comment !== undefined) updateData.comment = comment;
    if (icon) updateData.icon = icon;

    // Handle image updates - intelligent image management
    try {
      console.log('[UPDATE_PIN_LOCATION] Files received:', req.files ? req.files.length : 0);
      console.log('[UPDATE_PIN_LOCATION] Current images:', pinLocation.images);
      console.log('[UPDATE_PIN_LOCATION] Request body:', req.body);
      
      // Check if user wants to clear all images
      const shouldClearImages = req.body.images === '[]' || req.body.images === '';
      
      // Check if user wants to keep specific existing images
      const keepExistingImages = req.body.keepExistingImages;
      
      if (req.files && req.files.length > 0) {
        // User is adding new images
        console.log('[UPDATE_PIN_LOCATION] Adding new images');
        
        // Determine which existing images to keep
        let imagesToKeep = [];
        if (keepExistingImages && Array.isArray(keepExistingImages)) {
          imagesToKeep = keepExistingImages;
          console.log('[UPDATE_PIN_LOCATION] Keeping existing images:', imagesToKeep);
        }
        
        // Delete only the images that are NOT being kept
        const imagesToDelete = pinLocation.images.filter(img => !imagesToKeep.includes(img));
        console.log('[UPDATE_PIN_LOCATION] Images to delete:', imagesToDelete);
        
        try {
          if (imagesToDelete.length > 0) {
            await Promise.all(imagesToDelete.map(async (oldImage) => {
              try {
                const filename = oldImage.replace('/uploads/pin-locations/', '');
                const oldImagePath = path.join(__dirname, '..', 'uploads', 'pin-locations', filename);
                console.log('[UPDATE_PIN_LOCATION] Deleting file:', oldImagePath);
                await fs.unlink(oldImagePath);
              } catch (fileError) {
                console.log('[UPDATE_PIN_LOCATION] Could not delete old image:', fileError.message);
              }
            }));
          }
        } catch (error) {
          console.log('[UPDATE_PIN_LOCATION] Could not delete old images:', error.message);
        }
        
        // Combine kept existing images with new images
        const newImagePaths = req.files.map(file => `/uploads/pin-locations/${file.filename}`);
        updateData.images = [...imagesToKeep, ...newImagePaths];
        console.log('[UPDATE_PIN_LOCATION] Final images:', updateData.images);
        
      } else if (shouldClearImages) {
        // User wants to clear all images
        console.log('[UPDATE_PIN_LOCATION] Clearing all images as requested');
        
        // Delete all old images
        try {
          if (pinLocation.images && pinLocation.images.length > 0) {
            await Promise.all(pinLocation.images.map(async (oldImage) => {
              try {
                const filename = oldImage.replace('/uploads/pin-locations/', '');
                const oldImagePath = path.join(__dirname, '..', 'uploads', 'pin-locations', filename);
                console.log('[UPDATE_PIN_LOCATION] Deleting file:', oldImagePath);
                await fs.unlink(oldImagePath);
              } catch (fileError) {
                console.log('[UPDATE_PIN_LOCATION] Could not delete old image:', fileError.message);
              }
            }));
          }
        } catch (error) {
          console.log('[UPDATE_PIN_LOCATION] Could not delete old images:', error.message);
        }
        
        // Set images to empty array
        updateData.images = [];
        console.log('[UPDATE_PIN_LOCATION] Images cleared');
        
      } else if (keepExistingImages && Array.isArray(keepExistingImages)) {
        // User wants to keep only specific existing images (no new images)
        console.log('[UPDATE_PIN_LOCATION] Keeping only specified existing images:', keepExistingImages);
        
        // Delete images that are NOT being kept
        const imagesToDelete = pinLocation.images.filter(img => !keepExistingImages.includes(img));
        console.log('[UPDATE_PIN_LOCATION] Images to delete:', imagesToDelete);
        
        try {
          if (imagesToDelete.length > 0) {
            await Promise.all(imagesToDelete.map(async (oldImage) => {
              try {
                const filename = oldImage.replace('/uploads/pin-locations/', '');
                const oldImagePath = path.join(__dirname, '..', 'uploads', 'pin-locations', filename);
                console.log('[UPDATE_PIN_LOCATION] Deleting file:', oldImagePath);
                await fs.unlink(oldImagePath);
              } catch (fileError) {
                console.log('[UPDATE_PIN_LOCATION] Could not delete old image:', fileError.message);
              }
            }));
          }
        } catch (error) {
          console.log('[UPDATE_PIN_LOCATION] Could not delete old images:', error.message);
        }
        
        // Keep only the specified existing images
        updateData.images = keepExistingImages;
        console.log('[UPDATE_PIN_LOCATION] Images updated to:', updateData.images);
        
      } else {
        // No changes to images - keep existing ones
        console.log('[UPDATE_PIN_LOCATION] No image changes, keeping existing:', pinLocation.images);
        // Don't update images field - keep existing ones
      }
    } catch (imageError) {
      console.error('[UPDATE_PIN_LOCATION] Error in image handling:', imageError);
      // Continue with the update even if image handling fails
    }

    // Update timestamp
    updateData.updatedAt = new Date();

    // Update pin location
    const updatedPinLocation = await PinLocation.findByIdAndUpdate(
      pinId,
      updateData,
      { new: true, runValidators: true }
    ).populate('userId', 'name username profilePicture');

    // Update corresponding chat message if content changed
    if (comment || icon || name || latitude !== undefined || longitude !== undefined) {
      const message = await Message.findOne({
        'metadata.pinLocationId': pinId,
        type: 'customLocation'
      });

      if (message) {
        const messageUpdates = {};
        if (comment) messageUpdates['content.comment'] = comment;
        if (icon) messageUpdates['content.icon'] = icon;
        if (name) messageUpdates['content.name'] = name;
        if (latitude !== undefined || longitude !== undefined) {
          messageUpdates['content.coordinates'] = {
            latitude: updatedPinLocation.latitude,
            longitude: updatedPinLocation.longitude
          };
        }

        await Message.findByIdAndUpdate(message._id, messageUpdates);
      }
    }

    // Emit WebSocket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      const pinLocationWithUrls = {
        ...updatedPinLocation.toObject(),
        images: updatedPinLocation.images.map(img => img.startsWith('/uploads/pin-locations/') ? img : `/uploads/pin-locations/${img}`)
      };

      console.log('[SOCKET_DEBUG] IO instance available:', !!io);
      console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
      io.to(`connection:${pinLocation.connectionId}`).emit('pinLocationUpdated', {
        pinLocation: pinLocationWithUrls
      });

      console.log('[SOCKET_DEBUG] IO instance available:', !!io);
      console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
      io.to(`chat:${pinLocation.chatId}`).emit('pinLocationMessageUpdated', {
        pinLocationId: pinId,
        updates: updateData
      });
    }

    res.json({
      success: true,
      message: 'Pin location updated successfully',
      pinLocation: {
        ...updatedPinLocation.toObject(),
        images: updatedPinLocation.images.map(img => img.startsWith('/uploads/pin-locations/') ? img : `/uploads/pin-locations/${img}`)
      }
    });

  } catch (error) {
    console.error('[UPDATE_PIN_LOCATION] Error:', error);
    
    // Clean up uploaded files if there was an error
    if (req.files && req.files.length > 0) {
      try {
        await Promise.all(req.files.map(file => fs.unlink(file.path)));
      } catch (unlinkError) {
        console.error('[UPDATE_PIN_LOCATION] Error deleting files:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update pin location',
      error: error.message
    });
  }
};

// Delete a pin location
const deletePinLocation = async (req, res) => {
  try {
    const { pinId } = req.params;
    const userId = req.user.id;

    console.log('[DELETE_PIN_LOCATION] Request received:', { pinId, userId });

    // Find pin location
    const pinLocation = await PinLocation.findById(pinId);
    if (!pinLocation) {
      return res.status(404).json({
        success: false,
        message: 'Pin location not found'
      });
    }

    // Check ownership
    if (pinLocation.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied - only creator can delete'
      });
    }

    // Delete associated images
    try {
      await Promise.all(pinLocation.images.map(async (image) => {
        const imagePath = path.join(__dirname, '../uploads/pin-locations', image);
        await fs.unlink(imagePath);
      }));
    } catch (unlinkError) {
      console.error('[DELETE_PIN_LOCATION] Error deleting images:', unlinkError);
    }

    // Delete associated chat message
    try {
      await Message.deleteMany({
        'metadata.pinLocationId': pinId,
        type: 'customLocation'
      });
    } catch (messageError) {
      console.error('[DELETE_PIN_LOCATION] Error deleting message:', messageError);
    }

    // Delete pin location
    await PinLocation.findByIdAndDelete(pinId);

    // Emit WebSocket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      console.log('[SOCKET_DEBUG] IO instance available:', !!io);
      console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
      io.to(`connection:${pinLocation.connectionId}`).emit('pinLocationDeleted', {
        pinLocationId: pinId
      });

      console.log('[SOCKET_DEBUG] IO instance available:', !!io);
      console.log('[SOCKET_DEBUG] IO engine clients count:', io.engine?.clientsCount);
      io.to(`chat:${pinLocation.chatId}`).emit('pinLocationMessageDeleted', {
        pinLocationId: pinId
      });
    }

    res.json({
      success: true,
      message: 'Pin location deleted successfully'
    });

  } catch (error) {
    console.error('[DELETE_PIN_LOCATION] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete pin location',
      error: error.message
    });
  }
};

// Get user's active pin locations
const getUserPinLocations = async (req, res) => {
  try {
    const userId = req.user.id;

    const pinLocations = await PinLocation.getUserActivePins(userId);

    // Add full image URLs
    const pinLocationsWithUrls = pinLocations.map(pin => ({
      ...pin.toObject(),
      images: pin.images.map(img => img.startsWith('/uploads/pin-locations/') ? img : `/uploads/pin-locations/${img}`)
    }));

    res.json({
      success: true,
      pinLocations: pinLocationsWithUrls,
      count: pinLocationsWithUrls.length
    });

  } catch (error) {
    console.error('[GET_USER_PIN_LOCATIONS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user pin locations'
    });
  }
};

// Cleanup expired pin locations (admin/maintenance function)
const cleanupExpiredPins = async (req, res) => {
  try {
    const cleanedCount = await PinLocation.cleanupExpiredPins();

    res.json({
      success: true,
      message: 'Cleanup completed successfully',
      cleanedCount
    });

  } catch (error) {
    console.error('[CLEANUP_EXPIRED_PINS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup expired pins',
      error: error.message
    });
  }
};

// Get pin location statistics
const getPinLocationStats = async (req, res) => {
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

    // Get statistics
    const totalPins = await PinLocation.countDocuments({ connectionId });
    const activePins = await PinLocation.countDocuments({ 
      connectionId, 
      isActive: true,
      expiresAt: { $gt: new Date() }
    });
    const expiredPins = await PinLocation.countDocuments({ 
      connectionId, 
      expiresAt: { $lte: new Date() }
    });

    // Get type distribution
    const typeStats = await PinLocation.aggregate([
      { $match: { connectionId: new mongoose.Types.ObjectId(connectionId) } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      success: true,
      stats: {
        totalPins,
        activePins,
        expiredPins,
        typeDistribution: typeStats
      }
    });

  } catch (error) {
    console.error('[GET_PIN_LOCATION_STATS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pin location statistics'
    });
  }
};

module.exports = {
  createPinLocation,
  getPinLocations,
  getPinLocation,
  updatePinLocation,
  deletePinLocation,
  getUserPinLocations,
  cleanupExpiredPins,
  getPinLocationStats
};
