const Connection = require('../models/Connection');
const User = require('../models/User');
const mongoose = require('mongoose');

// Get group marked locations (owner only)
const getGroupMarkedLocations = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.user.id;

    // Check if user is owner of the connection
    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    const isOwner = connection.users.some(
      user => user.userId.toString() === userId && user.role === 'owner' && user.status === 'active'
    );

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Only connection owner can access group locations'
      });
    }

    res.json({
      success: true,
      markedLocations: connection.markedLocations
    });
  } catch (error) {
    console.error('Error fetching group marked locations:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Create group marked location (owner only)
const createGroupLocation = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.user.id;
    const { type, name, latitude, longitude, comment, images } = req.body;

    // Validate required fields
    if (!type || !name || !latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Validate type
    if (!['bus_station', 'hotel'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid location type'
      });
    }

    // Check if user is owner of the connection
    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    const isOwner = connection.users.some(
      user => user.userId.toString() === userId && user.role === 'owner' && user.status === 'active'
    );

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Only connection owner can create group locations'
      });
    }

    // Create new group location
    const newLocation = {
      _id: new mongoose.Types.ObjectId(),
      type,
      name,
      latitude,
      longitude,
      comment: comment || '',
      images: images || [],
      markedBy: userId,
      isOwnerMarked: true,
      isPersonalMarked: false,
      scope: {
        type: 'group',
        userId: null,
        isOwnerPersonal: false
      },
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Add to connection's marked locations
    connection.markedLocations.push(newLocation);
    await connection.save();

    // Sync to all users' active locations
    console.log('Syncing group location to users:', {
      connectionId,
      locationId: newLocation._id,
      locationType: newLocation.type,
      locationName: newLocation.name
    });
    await syncGroupLocationToUsers(connectionId, newLocation);

    // Note: Real-time updates are handled by frontend contexts
    // Socket emission removed as req.io is not available in controller

    res.status(201).json({
      success: true,
      message: 'Group location created successfully',
      location: newLocation
    });
  } catch (error) {
    console.error('Error creating group location:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Update group marked location (owner only)
const updateGroupLocation = async (req, res) => {
  try {
    const { connectionId, locationId } = req.params;
    const userId = req.user.id;
    const { name, latitude, longitude, comment, images } = req.body;

    // Check if user is owner of the connection
    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    const isOwner = connection.users.some(
      user => user.userId.toString() === userId && user.role === 'owner' && user.status === 'active'
    );

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Only connection owner can update group locations'
      });
    }

    // Find and update the location
    const location = connection.markedLocations.id(locationId);
    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }

    // Update location fields
    if (name) location.name = name;
    if (latitude) location.latitude = latitude;
    if (longitude) location.longitude = longitude;
    if (comment !== undefined) location.comment = comment;
    if (images) location.images = images;
    location.updatedAt = new Date();

    await connection.save();

    // Sync to all users' active locations
    await syncGroupLocationToUsers(connectionId, location);

    // Note: Real-time updates are handled by frontend contexts
    // Socket emission removed as req.io is not available in controller

    res.json({
      success: true,
      message: 'Group location updated successfully',
      location
    });
  } catch (error) {
    console.error('Error updating group location:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Delete group marked location (owner only)
const deleteGroupLocation = async (req, res) => {
  try {
    const { connectionId, locationId } = req.params;
    const userId = req.user.id;

    // Check if user is owner of the connection
    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    const isOwner = connection.users.some(
      user => user.userId.toString() === userId && user.role === 'owner' && user.status === 'active'
    );

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Only connection owner can delete group locations'
      });
    }

    // Find and remove the location
    const location = connection.markedLocations.id(locationId);
    if (!location) {
      return res.status(404).json({
        success: false,
        message: 'Location not found'
      });
    }

    const locationType = location.type;
    connection.markedLocations.pull(locationId);
    await connection.save();

    // Reset all users' active locations for this type
    await resetUsersActiveLocation(connectionId, locationType);

    // Note: Real-time updates are handled by frontend contexts
    // Socket emission removed as req.io is not available in controller

    res.json({
      success: true,
      message: 'Group location deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting group location:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Transfer ownership with location choices
const transferOwnership = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const currentOwnerId = req.user.id;
    const { newOwnerId, busStationChoice, hotelChoice } = req.body;

    // Validate choices
    if (!['replace', 'keep'].includes(busStationChoice) || !['replace', 'keep'].includes(hotelChoice)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid choice values'
      });
    }

    // Check if current user is owner
    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    const isCurrentOwner = connection.users.some(
      user => user.userId.toString() === currentOwnerId && user.role === 'owner' && user.status === 'active'
    );

    if (!isCurrentOwner) {
      return res.status(403).json({
        success: false,
        message: 'Only current owner can transfer ownership'
      });
    }

    // Check if new owner is a member
    const isNewOwnerMember = connection.users.some(
      user => user.userId.toString() === newOwnerId && user.status === 'active'
    );

    if (!isNewOwnerMember) {
      return res.status(400).json({
        success: false,
        message: 'New owner must be an active member of the connection'
      });
    }

    // Get new owner's personal locations
    const newOwner = await User.findById(newOwnerId);
    if (!newOwner) {
      return res.status(404).json({
        success: false,
        message: 'New owner not found'
      });
    }

    // Handle bus station choice
    if (busStationChoice === 'replace' && newOwner.activeLocations.busStation.isMarked) {
      // Replace group bus station with new owner's personal
      const newBusStation = {
        _id: new mongoose.Types.ObjectId(),
        type: 'bus_station',
        name: newOwner.activeLocations.busStation.name,
        latitude: newOwner.activeLocations.busStation.latitude,
        longitude: newOwner.activeLocations.busStation.longitude,
        comment: '',
        images: [],
        markedBy: newOwnerId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Remove old bus station and add new one
      connection.markedLocations = connection.markedLocations.filter(
        loc => loc.type !== 'bus_station'
      );
      connection.markedLocations.push(newBusStation);
    }

    // Handle hotel choice
    if (hotelChoice === 'replace' && newOwner.activeLocations.hotel.isMarked) {
      // Replace group hotel with new owner's personal
      const newHotel = {
        _id: new mongoose.Types.ObjectId(),
        type: 'hotel',
        name: newOwner.activeLocations.hotel.name,
        latitude: newOwner.activeLocations.hotel.latitude,
        longitude: newOwner.activeLocations.hotel.longitude,
        comment: '',
        images: [],
        markedBy: newOwnerId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Remove old hotel and add new one
      connection.markedLocations = connection.markedLocations.filter(
        loc => loc.type !== 'hotel'
      );
      connection.markedLocations.push(newHotel);
    }

    // Update connection owner
    connection.users.forEach(user => {
      if (user.userId.toString() === currentOwnerId) {
        user.role = 'member';
      }
      if (user.userId.toString() === newOwnerId) {
        user.role = 'owner';
      }
    });

    await connection.save();

    // Remove old owner's personal locations
    await removeUserPersonalLocations(currentOwnerId, connectionId);

    // Sync all users' active locations
    await syncAllUsersMarkedLocations(connectionId);

    // Note: Real-time updates are handled by frontend contexts
    // Socket emission removed as req.io is not available in controller

    res.json({
      success: true,
      message: 'Ownership transferred successfully'
    });
  } catch (error) {
    console.error('Error transferring ownership:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Helper function to sync group location to all users
async function syncGroupLocationToUsers(connectionId, groupLocation) {
  try {
    console.log('Starting sync for connection:', connectionId);
    const connection = await Connection.findById(connectionId).populate('users.userId');
    
    if (!connection) {
      console.error('Connection not found:', connectionId);
      return;
    }
    
    console.log('Found connection with users:', connection.users.length);
    
    for (const userConnection of connection.users) {
      if (userConnection.status === 'active') {
        const userId = userConnection.userId._id;
        const locationField = groupLocation.type === 'bus_station' ? 'busStation' : 'hotel';
        
        console.log(`Processing user ${userId} for ${locationField}`);
        
        // Check if user has personal location for this type
        const user = await User.findById(userId);
        if (!user) {
          console.error('User not found:', userId);
          continue;
        }
        
        const hasPersonal = user.activeLocations[locationField].source === 'personal';
        console.log(`User ${userId} has personal ${locationField}:`, hasPersonal);
        
        if (!hasPersonal) {
          // Update user's active location with group location
          const updateData = {
            [`activeLocations.${locationField}.name`]: groupLocation.name,
            [`activeLocations.${locationField}.latitude`]: groupLocation.latitude,
            [`activeLocations.${locationField}.longitude`]: groupLocation.longitude,
            [`activeLocations.${locationField}.source`]: 'group',
            [`activeLocations.${locationField}.locationId`]: groupLocation._id,
            [`activeLocations.${locationField}.connectionId`]: connectionId,
            [`activeLocations.${locationField}.isMarked`]: true,
            [`activeLocations.${locationField}.lastUpdated`]: new Date()
          };

          console.log(`Updating user ${userId} with data:`, updateData);
          await User.findByIdAndUpdate(userId, updateData);
          console.log(`Successfully updated user ${userId}`);
        } else {
          console.log(`Skipping user ${userId} - has personal location`);
        }
      }
    }
    console.log('Sync completed for connection:', connectionId);
  } catch (error) {
    console.error('Error syncing group location to users:', error);
  }
}

// Helper function to reset users' active location for a specific type
async function resetUsersActiveLocation(connectionId, locationType) {
  try {
    const connection = await Connection.findById(connectionId).populate('users.userId');
    
    for (const userConnection of connection.users) {
      if (userConnection.status === 'active') {
        const userId = userConnection.userId._id;
        const locationField = locationType === 'bus_station' ? 'busStation' : 'hotel';
        
        // Reset to unmarked state
        const resetData = {
          [`activeLocations.${locationField}.name`]: 'Unmarked',
          [`activeLocations.${locationField}.latitude`]: null,
          [`activeLocations.${locationField}.longitude`]: null,
          [`activeLocations.${locationField}.source`]: 'unmarked',
          [`activeLocations.${locationField}.locationId`]: null,
          [`activeLocations.${locationField}.connectionId`]: null,
          [`activeLocations.${locationField}.isMarked`]: false,
          [`activeLocations.${locationField}.lastUpdated`]: new Date()
        };

        if (locationType === 'hotel') {
          resetData[`activeLocations.${locationField}.roomNumber`] = null;
        }

        await User.findByIdAndUpdate(userId, resetData);
      }
    }
  } catch (error) {
    console.error('Error resetting users active location:', error);
  }
}

// Helper function to sync all users' marked locations
async function syncAllUsersMarkedLocations(connectionId) {
  try {
    const connection = await Connection.findById(connectionId);
    
    // Sync each group location to all users
    for (const groupLocation of connection.markedLocations) {
      await syncGroupLocationToUsers(connectionId, groupLocation);
    }
  } catch (error) {
    console.error('Error syncing all users marked locations:', error);
  }
}

// Helper function to remove user's personal locations
async function removeUserPersonalLocations(userId, connectionId) {
  try {
    const user = await User.findById(userId);
    
    // Reset bus station if it's personal
    if (user.activeLocations.busStation.source === 'personal' && 
        user.activeLocations.busStation.connectionId?.toString() === connectionId) {
      user.activeLocations.busStation = {
        name: 'Unmarked',
        latitude: null,
        longitude: null,
        source: 'unmarked',
        locationId: null,
        connectionId: null,
        isMarked: false,
        lastUpdated: new Date()
      };
    }
    
    // Reset hotel if it's personal
    if (user.activeLocations.hotel.source === 'personal' && 
        user.activeLocations.hotel.connectionId?.toString() === connectionId) {
      user.activeLocations.hotel = {
        name: 'Unmarked',
        roomNumber: null,
        latitude: null,
        longitude: null,
        source: 'unmarked',
        locationId: null,
        connectionId: null,
        isMarked: false,
        lastUpdated: new Date()
      };
    }
    
    await user.save();
  } catch (error) {
    console.error('Error removing user personal locations:', error);
  }
}

module.exports = {
  getGroupMarkedLocations,
  createGroupLocation,
  updateGroupLocation,
  deleteGroupLocation,
  transferOwnership
};
