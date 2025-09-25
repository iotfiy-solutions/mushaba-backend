/**
 * Enhanced Location Controller
 * Handles the new location marking system with personal/group locations and ownership transfer
 */

const Connection = require('../models/Connection');
const User = require('../models/User');
const Location = require('../models/Location');
const fs = require('fs').promises;
const path = require('path');

// Helper function to create uploads directory
const createUploadsDirectory = async () => {
  const uploadsDir = path.join(__dirname, '../uploads/locations');
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
};

/**
 * Mark a location (enhanced with personal/group logic)
 */
const markLocation = async (req, res) => {
  try {
    await createUploadsDirectory();

    const { 
      connectionId, 
      type, 
      name, 
      latitude, 
      longitude, 
      comment, 
      distance,
      isPersonal 
    } = req.body;
    
    // Convert string to boolean for FormData
    const isPersonalMarking = isPersonal === 'true' || isPersonal === true;
    const userId = req.user.id;
    
    console.log('[ENHANCED_MARK_LOCATION] Request received:', {
      connectionId,
      type,
      name,
      latitude,
      longitude,
      comment,
      distance,
      userId,
      isPersonal: isPersonalMarking
    });

    // Validate required fields
    if (!connectionId || !type || !name || !latitude || !longitude || !comment) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Validate images upload (optional, but if provided, max 1 image)
    if (req.files && req.files.length > 1) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 1 image allowed'
      });
    }

    // Find the connection
    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    // Verify user is in connection
    const userInConnection = connection.users.find(
      u => u.userId.toString() === userId && u.status === 'active'
    );
    if (!userInConnection) {
      return res.status(403).json({
        success: false,
        message: 'User not found in connection'
      });
    }

    const isOwner = userInConnection.role === 'owner';

    // Process marking based on type and user role
    if (isPersonalMarking) {
      // Personal marking - both owner and members can do this
      await markPersonalLocation(connection, userId, req.body, req.files);
    } else {
      // Group marking - only owner allowed
      if (!isOwner) {
        return res.status(403).json({
          success: false,
          message: 'Only connection owner can mark group locations'
        });
      }
      await markGroupLocation(connection, userId, req.body, req.files);
    }

    // Sync to all users' cache
    await syncAllUsersCache(connectionId);

    res.json({
      success: true,
      message: 'Location marked successfully',
      isPersonal,
      isOwner
    });

  } catch (error) {
    console.error('[ENHANCED_MARK_LOCATION] Error:', error);
    
    // Clean up uploaded files if there was an error
    if (req.files && req.files.length > 0) {
      try {
        await Promise.all(req.files.map(file => fs.unlink(file.path)));
      } catch (unlinkError) {
        console.error('[ENHANCED_MARK_LOCATION] Error deleting files:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Failed to mark location'
    });
  }
};

/**
 * Mark personal location (overrides group for the user)
 */
const markPersonalLocation = async (connection, userId, locationData, files) => {
  const { type, name, latitude, longitude, comment, distance } = locationData;
  
  // Remove existing personal location of same type
  connection.markedLocations = connection.markedLocations.filter(
    loc => !(loc.scope.type === 'personal' && loc.scope.userId.toString() === userId && loc.type === type)
  );

  // Add new personal location
  const newLocation = {
    type,
    name,
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    comment,
    distance: parseFloat(distance) || 0,
    images: files ? files.map(file => file.filename) : [],
    markedBy: userId,
    isOwnerMarked: false,
    isPersonalMarked: true,
    scope: {
      type: 'personal',
      userId: userId,
      isOwnerPersonal: false
    },
    markedAt: new Date(),
    updatedAt: new Date()
  };

  connection.markedLocations.push(newLocation);
  await connection.save();

  console.log(`[PERSONAL_MARK] Marked personal ${type} for user ${userId}`);
};

/**
 * Mark group location (owner's choice for all members)
 */
const markGroupLocation = async (connection, userId, locationData, files) => {
  const { type, name, latitude, longitude, comment, distance } = locationData;
  
  // Remove existing group location of same type
  connection.markedLocations = connection.markedLocations.filter(
    loc => !(loc.scope.type === 'group' && loc.type === type)
  );

  // Add new group location
  const newLocation = {
    type,
    name,
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    comment,
    distance: parseFloat(distance) || 0,
    images: files ? files.map(file => file.filename) : [],
    markedBy: userId,
    isOwnerMarked: true,
    isPersonalMarked: false,
    scope: {
      type: 'group',
      userId: null,
      isOwnerPersonal: true // Owner's group location is also their personal
    },
    markedAt: new Date(),
    updatedAt: new Date()
  };

  connection.markedLocations.push(newLocation);
  await connection.save();

  console.log(`[GROUP_MARK] Marked group ${type} by owner ${userId}`);
};

/**
 * Get marked locations for a connection (with priority logic)
 */
const getMarkedLocations = async (req, res) => {
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

    // Verify user is in connection
    const userInConnection = connection.users.find(
      u => u.userId.toString() === userId && u.status === 'active'
    );
    if (!userInConnection) {
      return res.status(403).json({
        success: false,
        message: 'User not found in connection'
      });
    }

    const isOwner = userInConnection.role === 'owner';
    
    // Get active locations based on priority
    const activeLocations = getActiveLocationsForUser(connection, userId, isOwner);

    res.json({
      success: true,
      locations: activeLocations,
      isOwner
    });

  } catch (error) {
    console.error('[GET_MARKED_LOCATIONS] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get marked locations'
    });
  }
};

/**
 * Get active locations for a user based on priority
 */
const getActiveLocationsForUser = (connection, userId, isOwner) => {
  const locations = [];
  
  // For each location type (bus_station, hotel)
  ['bus_station', 'hotel'].forEach(type => {
    const personalLocation = connection.markedLocations.find(loc => 
      loc.scope.type === 'personal' && 
      loc.scope.userId.toString() === userId && 
      loc.type === type
    );
    
    const groupLocation = connection.markedLocations.find(loc => 
      loc.scope.type === 'group' && loc.type === type
    );

    let activeLocation;
    if (isOwner) {
      // Owner always sees group location (which is their personal too)
      if (groupLocation) {
        activeLocation = {
          _id: groupLocation._id,
          type: groupLocation.type,
          name: groupLocation.name,
          latitude: groupLocation.latitude,
          longitude: groupLocation.longitude,
          comment: groupLocation.comment,
          distance: groupLocation.distance,
          images: groupLocation.images,
          markedBy: groupLocation.markedBy,
          markedAt: groupLocation.markedAt,
          updatedAt: groupLocation.updatedAt,
          source: 'group',
          isMarked: true
        };
      } else {
        activeLocation = { 
          name: "Unmarked", 
          source: "unmarked", 
          isMarked: false 
        };
      }
    } else {
      // Member priority: Personal > Group > Unmarked
      if (personalLocation) {
        activeLocation = {
          _id: personalLocation._id,
          type: personalLocation.type,
          name: personalLocation.name,
          latitude: personalLocation.latitude,
          longitude: personalLocation.longitude,
          comment: personalLocation.comment,
          distance: personalLocation.distance,
          images: personalLocation.images,
          markedBy: personalLocation.markedBy,
          markedAt: personalLocation.markedAt,
          updatedAt: personalLocation.updatedAt,
          source: 'personal',
          isMarked: true
        };
      } else if (groupLocation) {
        activeLocation = {
          _id: groupLocation._id,
          type: groupLocation.type,
          name: groupLocation.name,
          latitude: groupLocation.latitude,
          longitude: groupLocation.longitude,
          comment: groupLocation.comment,
          distance: groupLocation.distance,
          images: groupLocation.images,
          markedBy: groupLocation.markedBy,
          markedAt: groupLocation.markedAt,
          updatedAt: groupLocation.updatedAt,
          source: 'group',
          isMarked: true
        };
      } else {
        activeLocation = { 
          name: "Unmarked", 
          source: "unmarked", 
          isMarked: false 
        };
      }
    }

    locations.push(activeLocation);
  });

  return locations;
};

/**
 * Sync all users' cache for a connection
 */
const syncAllUsersCache = async (connectionId) => {
  try {
    const connection = await Connection.findById(connectionId);
    if (!connection) return;

    const groupLocations = connection.markedLocations.filter(loc => loc.scope.type === 'group');
    const busLocation = groupLocations.find(loc => loc.type === 'bus_station');
    const hotelLocation = groupLocations.find(loc => loc.type === 'hotel');

    // Update all users in the connection
    for (const userInConnection of connection.users) {
      const userId = userInConnection.userId;
      const isOwner = userInConnection.role === 'owner';

      // Get user's personal locations
      const personalLocations = connection.markedLocations.filter(loc => 
        loc.scope.type === 'personal' && loc.scope.userId.toString() === userId.toString()
      );
      const personalBus = personalLocations.find(loc => loc.type === 'bus_station');
      const personalHotel = personalLocations.find(loc => loc.type === 'hotel');

      // Determine active locations based on priority
      const activeBus = personalBus || busLocation;
      const activeHotel = personalHotel || hotelLocation;

      // Update user's cache
      await User.findByIdAndUpdate(userId, {
        $set: {
          'activeLocations.busStation': {
            name: activeBus?.name || "Unmarked",
            latitude: activeBus?.latitude || null,
            longitude: activeBus?.longitude || null,
            source: personalBus ? 'personal' : (busLocation ? 'group' : 'unmarked'),
            locationId: activeBus?._id || null,
            connectionId: connectionId,
            isMarked: !!activeBus,
            lastUpdated: new Date()
          },
          'activeLocations.hotel': {
            name: activeHotel?.name || "Unmarked",
            roomNumber: activeHotel?.roomNumber || null,
            latitude: activeHotel?.latitude || null,
            longitude: activeHotel?.longitude || null,
            source: personalHotel ? 'personal' : (hotelLocation ? 'group' : 'unmarked'),
            locationId: activeHotel?._id || null,
            connectionId: connectionId,
            isMarked: !!activeHotel,
            lastUpdated: new Date()
          }
        }
      });
    }

    console.log(`[CACHE_SYNC] Updated cache for all users in connection ${connectionId}`);

  } catch (error) {
    console.error('[CACHE_SYNC] Error:', error);
  }
};

/**
 * Handle ownership transfer with conflict resolution
 */
const handleOwnershipTransfer = async (req, res) => {
  try {
    const { connectionId, newOwnerId, choices } = req.body;
    const currentUserId = req.user.id;

    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    // Verify current user is owner
    const currentUser = connection.users.find(u => u.userId.toString() === currentUserId);
    if (!currentUser || currentUser.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Only current owner can transfer ownership'
      });
    }

    // Process choices for each location type
    if (choices.bus === 'personal') {
      await usePersonalAsGroup(connection, newOwnerId, 'bus_station');
    } else {
      await keepPreviousAsGroup(connection, newOwnerId, 'bus_station');
    }

    if (choices.hotel === 'personal') {
      await usePersonalAsGroup(connection, newOwnerId, 'hotel');
    } else {
      await keepPreviousAsGroup(connection, newOwnerId, 'hotel');
    }

    // Update roles
    currentUser.role = 'member';
    const newOwner = connection.users.find(u => u.userId.toString() === newOwnerId);
    if (newOwner) {
      newOwner.role = 'owner';
    }

    await connection.save();

    // Sync all users' cache
    await syncAllUsersCache(connectionId);

    res.json({
      success: true,
      message: 'Ownership transferred successfully',
      choices
    });

  } catch (error) {
    console.error('[OWNERSHIP_TRANSFER] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to transfer ownership'
    });
  }
};

/**
 * Use personal location as group location
 */
const usePersonalAsGroup = async (connection, newOwnerId, type) => {
  // Find new owner's personal location
  const personalLocation = connection.markedLocations.find(loc => 
    loc.scope.type === 'personal' && 
    loc.scope.userId.toString() === newOwnerId && 
    loc.type === type
  );

  if (personalLocation) {
    // Remove old group location
    connection.markedLocations = connection.markedLocations.filter(
      loc => !(loc.scope.type === 'group' && loc.type === type)
    );

    // Convert personal to group
    personalLocation.scope.type = 'group';
    personalLocation.scope.userId = null;
    personalLocation.markedBy = newOwnerId;
    personalLocation.isOwnerMarked = true;
    personalLocation.isPersonalMarked = false;
    personalLocation.updatedAt = new Date();
  }
};

/**
 * Keep previous group location
 */
const keepPreviousAsGroup = async (connection, newOwnerId, type) => {
  // Remove new owner's personal location
  connection.markedLocations = connection.markedLocations.filter(
    loc => !(loc.scope.type === 'personal' && loc.scope.userId.toString() === newOwnerId && loc.type === type)
  );

  // Update group location ownership
  const groupLocation = connection.markedLocations.find(loc => 
    loc.scope.type === 'group' && loc.type === type
  );
  
  if (groupLocation) {
    groupLocation.markedBy = newOwnerId;
    groupLocation.updatedAt = new Date();
  }
};

// Delete a marked location (personal or group)
const deleteMarkedLocation = async (req, res) => {
  try {
    const { locationId } = req.params;
    const userId = req.user.id;

    console.log('[ENHANCED_DELETE_LOCATION] Request received:', {
      locationId,
      userId
    });

    // Find the location in the database
    const location = await Location.findById(locationId);
    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }

    // Check if user has permission to delete
    const canDelete = location.markedBy.toString() === userId.toString();
    if (!canDelete) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete locations you marked'
      });
    }

    // Delete the location
    await Location.findByIdAndDelete(locationId);

    // Find the connection to update user cache
    const connection = await Connection.findOne({
      'markedLocations.busStation': locationId
    }) || await Connection.findOne({
      'markedLocations.hotel': locationId
    });

    if (connection) {
      // Update connection's markedLocations
      if (connection.markedLocations.busStation?.toString() === locationId) {
        connection.markedLocations.busStation = null;
      }
      if (connection.markedLocations.hotel?.toString() === locationId) {
        connection.markedLocations.hotel = null;
      }
      await connection.save();

      // Update all users' activeLocations cache
      await syncAllUsersCache(connection._id);
    }

    // Update user's activeLocations if it's a personal location
    await User.updateMany(
      { 'activeLocations.busStation': locationId },
      { $unset: { 'activeLocations.busStation': 1 } }
    );
    await User.updateMany(
      { 'activeLocations.hotel': locationId },
      { $unset: { 'activeLocations.hotel': 1 } }
    );

    res.json({
      success: true,
      message: 'Location deleted successfully',
      locationType: location.type
    });

  } catch (error) {
    console.error('[ENHANCED_DELETE_LOCATION] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete location',
      error: error.message
    });
  }
};

module.exports = {
  markLocation,
  getMarkedLocations,
  handleOwnershipTransfer,
  syncAllUsersCache,
  getActiveLocationsForUser,
  deleteMarkedLocation
};
