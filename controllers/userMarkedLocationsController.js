const User = require('../models/User');
const Connection = require('../models/Connection');
const mongoose = require('mongoose');

// Get user's current marked locations (what they see on map)
const getUserMarkedLocations = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await User.findById(userId).select('activeLocations markedLocations');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const markedLocations = [];
    
    // Add bus station if marked
    if (user.activeLocations.busStation.isMarked) {
      markedLocations.push({
        _id: user.activeLocations.busStation.locationId,
        type: 'bus_station',
        name: user.activeLocations.busStation.name,
        latitude: user.activeLocations.busStation.latitude,
        longitude: user.activeLocations.busStation.longitude,
        source: user.activeLocations.busStation.source,
        connectionId: user.activeLocations.busStation.connectionId,
        isActive: true,
        lastUpdated: user.activeLocations.busStation.lastUpdated
      });
    }
    
    // Add hotel if marked
    if (user.activeLocations.hotel.isMarked) {
      markedLocations.push({
        _id: user.activeLocations.hotel.locationId,
        type: 'hotel',
        name: user.activeLocations.hotel.name,
        latitude: user.activeLocations.hotel.latitude,
        longitude: user.activeLocations.hotel.longitude,
        source: user.activeLocations.hotel.source,
        connectionId: user.activeLocations.hotel.connectionId,
        isActive: true,
        lastUpdated: user.activeLocations.hotel.lastUpdated
      });
    }

    // Also include all marked locations from the markedLocations array
    // This ensures members can see their personal locations
    if (user.markedLocations && user.markedLocations.length > 0) {
      user.markedLocations.forEach(location => {
        // Only add if not already in the array (avoid duplicates)
        const exists = markedLocations.some(marked => marked._id.toString() === location._id.toString());
        if (!exists) {
          markedLocations.push({
            _id: location._id,
            type: location.type,
            name: location.name,
            latitude: location.latitude,
            longitude: location.longitude,
            source: location.source,
            connectionId: location.connectionId,
            isActive: location.isActive,
            createdAt: location.createdAt,
            updatedAt: location.updatedAt
          });
        }
      });
    }

    res.json({
      success: true,
      markedLocations
    });
  } catch (error) {
    console.error('Error fetching user marked locations:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Create personal marked location
const createPersonalLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, name, latitude, longitude, connectionId, comment, images } = req.body;

    // Validate required fields
    if (!type || !name || !latitude || !longitude || !connectionId) {
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

    // Check if user is part of the connection
    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found'
      });
    }

    const isUserInConnection = connection.users.some(
      user => user.userId.toString() === userId && user.status === 'active'
    );

    if (!isUserInConnection) {
      return res.status(403).json({
        success: false,
        message: 'User not part of this connection'
      });
    }

    // Create location ID
    const locationId = new mongoose.Types.ObjectId();

    // Update user's active location and add to marked locations
    const locationField = type === 'bus_station' ? 'busStation' : 'hotel';
    
    const locationData = {
      _id: locationId,
      type,
      name,
      latitude,
      longitude,
      source: 'personal',
      connectionId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (type === 'hotel' && req.body.roomNumber) {
      locationData.roomNumber = req.body.roomNumber;
    }

    const updateData = {
      [`activeLocations.${locationField}.name`]: name,
      [`activeLocations.${locationField}.latitude`]: latitude,
      [`activeLocations.${locationField}.longitude`]: longitude,
      [`activeLocations.${locationField}.source`]: 'personal',
      [`activeLocations.${locationField}.locationId`]: locationId,
      [`activeLocations.${locationField}.connectionId`]: connectionId,
      [`activeLocations.${locationField}.isMarked`]: true,
      [`activeLocations.${locationField}.lastUpdated`]: new Date(),
      $push: { markedLocations: locationData }
    };

    if (type === 'hotel' && req.body.roomNumber) {
      updateData[`activeLocations.${locationField}.roomNumber`] = req.body.roomNumber;
    }

    await User.findByIdAndUpdate(userId, updateData);

    // Note: Real-time updates are handled by frontend contexts
    // Socket emission removed as req.io is not available in controller

    res.status(201).json({
      success: true,
      message: 'Personal location created successfully',
      location: {
        _id: locationId,
        type,
        name,
        latitude,
        longitude,
        source: 'personal',
        connectionId,
        isActive: true
      }
    });
  } catch (error) {
    console.error('Error creating personal location:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Update personal marked location
const updatePersonalLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { locationId } = req.params;
    const { name, latitude, longitude, comment, images } = req.body;

    // Find user and check if they have this personal location
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if location exists in user's active locations
    let locationField = null;
    let locationType = null;

    if (user.activeLocations.busStation.locationId?.toString() === locationId) {
      locationField = 'busStation';
      locationType = 'bus_station';
    } else if (user.activeLocations.hotel.locationId?.toString() === locationId) {
      locationField = 'hotel';
      locationType = 'hotel';
    }

    if (!locationField) {
      return res.status(404).json({
        success: false,
        message: 'Personal location not found'
      });
    }

    // Update location in both activeLocations and markedLocations
    const updateData = {
      [`activeLocations.${locationField}.name`]: name || user.activeLocations[locationField].name,
      [`activeLocations.${locationField}.latitude`]: latitude || user.activeLocations[locationField].latitude,
      [`activeLocations.${locationField}.longitude`]: longitude || user.activeLocations[locationField].longitude,
      [`activeLocations.${locationField}.lastUpdated`]: new Date()
    };

    if (locationType === 'hotel' && req.body.roomNumber !== undefined) {
      updateData[`activeLocations.${locationField}.roomNumber`] = req.body.roomNumber;
    }

    // Also update in markedLocations array
    const markedLocationUpdate = {
      $set: {
        [`markedLocations.$.name`]: name || user.activeLocations[locationField].name,
        [`markedLocations.$.latitude`]: latitude || user.activeLocations[locationField].latitude,
        [`markedLocations.$.longitude`]: longitude || user.activeLocations[locationField].longitude,
        [`markedLocations.$.updatedAt`]: new Date()
      }
    };

    if (locationType === 'hotel' && req.body.roomNumber !== undefined) {
      markedLocationUpdate.$set[`markedLocations.$.roomNumber`] = req.body.roomNumber;
    }

    // Update both activeLocations and markedLocations
    await User.findByIdAndUpdate(userId, updateData);
    await User.updateOne(
      { _id: userId, 'markedLocations._id': locationId },
      markedLocationUpdate
    );

    // Note: Real-time updates are handled by frontend contexts
    // Socket emission removed as req.io is not available in controller

    res.json({
      success: true,
      message: 'Personal location updated successfully'
    });
  } catch (error) {
    console.error('Error updating personal location:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Delete personal marked location (fallback to group)
const deletePersonalLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { locationId } = req.params;

    // Find user and check if they have this personal location
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if location exists in user's active locations
    let locationField = null;
    let locationType = null;

    if (user.activeLocations.busStation.locationId?.toString() === locationId) {
      locationField = 'busStation';
      locationType = 'bus_station';
    } else if (user.activeLocations.hotel.locationId?.toString() === locationId) {
      locationField = 'hotel';
      locationType = 'hotel';
    }

    if (!locationField) {
      return res.status(404).json({
        success: false,
        message: 'Personal location not found'
      });
    }

    const connectionId = user.activeLocations[locationField].connectionId;

    // Reset to group location (unmarked state)
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

    // Update both activeLocations and remove from markedLocations
    await User.findByIdAndUpdate(userId, resetData);
    await User.updateOne(
      { _id: userId },
      { $pull: { markedLocations: { _id: locationId } } }
    );

    // Note: Real-time updates are handled by frontend contexts
    // Socket emission removed as req.io is not available in controller

    res.json({
      success: true,
      message: 'Personal location deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting personal location:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Clear all personal marked locations for a user
const clearAllPersonalLocations = async (req, res) => {
  try {
    const userId = req.user.id;

    // Reset user's active locations to unmarked state
    const resetData = {
      'activeLocations.busStation.name': 'Unmarked',
      'activeLocations.busStation.latitude': null,
      'activeLocations.busStation.longitude': null,
      'activeLocations.busStation.source': 'unmarked',
      'activeLocations.busStation.locationId': null,
      'activeLocations.busStation.connectionId': null,
      'activeLocations.busStation.isMarked': false,
      'activeLocations.busStation.lastUpdated': new Date(),
      'activeLocations.hotel.name': 'Unmarked',
      'activeLocations.hotel.roomNumber': null,
      'activeLocations.hotel.latitude': null,
      'activeLocations.hotel.longitude': null,
      'activeLocations.hotel.source': 'unmarked',
      'activeLocations.hotel.locationId': null,
      'activeLocations.hotel.connectionId': null,
      'activeLocations.hotel.isMarked': false,
      'activeLocations.hotel.lastUpdated': new Date()
    };

    // Clear both activeLocations and markedLocations
    await User.findByIdAndUpdate(userId, resetData);
    await User.updateOne(
      { _id: userId },
      { $set: { markedLocations: [] } }
    );

    res.json({
      success: true,
      message: 'All personal locations cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing personal locations:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

module.exports = {
  getUserMarkedLocations,
  createPersonalLocation,
  updatePersonalLocation,
  deletePersonalLocation,
  clearAllPersonalLocations
};
