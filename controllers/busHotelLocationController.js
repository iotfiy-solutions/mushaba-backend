const User = require('../models/User');
const Connection = require('../models/Connection');
const Location = require('../models/Location');

// Get all locations for a user in a connection
const getLocations = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { scope } = req.query; // Get scope from query parameter
    const userId = req.user.id;

    console.warn('🚌 [BUS_HOTEL_LOCATION] Getting locations for user:', userId, 'in connection:', connectionId, 'scope:', scope);
    console.warn('🚌 [BUS_HOTEL_LOCATION] Query parameters:', req.query);

    // Get user data
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Get connection data
    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({ success: false, message: 'Connection not found' });
    }

    // Check if user is in this connection
    const userInConnection = connection.users.find(u => 
      u.userId.toString() === userId.toString() && u.status === 'active'
    );
    if (!userInConnection) {
      return res.status(403).json({ success: false, message: 'User not in this connection' });
    }

    // Get personal locations
    const personalBus = user.personalLocations?.bus;
    const personalHotel = user.personalLocations?.hotel;

    // Get group locations
    const groupBus = connection.groupLocations?.bus;
    const groupHotel = connection.groupLocations?.hotel;

    // Determine display logic based on scope parameter
    let displayBus, displayHotel;
    const userRole = userInConnection.role;

    if (scope === 'personal') {
      // Personal scope - show personal locations
      displayBus = personalBus;
      displayHotel = personalHotel;
      console.warn('🚌 [BUS_HOTEL_LOCATION] Using PERSONAL scope');
    } else {
      // Group scope (default) - show group locations
      displayBus = groupBus;
      displayHotel = groupHotel;
      console.warn('🚌 [BUS_HOTEL_LOCATION] Using GROUP scope');
    }

    console.warn('🚌 [BUS_HOTEL_LOCATION] Display logic result:', {
      scope,
      displayBus: displayBus ? 'Found' : 'Missing',
      displayHotel: displayHotel ? 'Found' : 'Missing',
      displayBusActive: displayBus?.isActive,
      displayHotelActive: displayHotel?.isActive,
      groupBusActive: groupBus?.isActive,
      groupHotelActive: groupHotel?.isActive
    });

    const response = {
      success: true,
      data: {
        bus: displayBus,
        hotel: displayHotel,
        personalBus,
        personalHotel,
        groupBus,
        groupHotel,
        userRole
      }
    };

    console.warn('🚌 [BUS_HOTEL_LOCATION] Locations retrieved successfully:', {
      displayBus: displayBus ? '✅ Found' : '❌ Missing',
      displayHotel: displayHotel ? '✅ Found' : '❌ Missing',
      personalBus: personalBus ? '✅ Found' : '❌ Missing',
      personalHotel: personalHotel ? '✅ Found' : '❌ Missing',
      groupBus: groupBus ? '✅ Found' : '❌ Missing',
      groupHotel: groupHotel ? '✅ Found' : '❌ Missing',
      userRole
    });

    res.json(response);
  } catch (error) {
    console.error('❌ [BUS_HOTEL_LOCATION] Error getting locations:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Mark a location (bus or hotel)
const markLocation = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { type, scope, locationData } = req.body;
    const userId = req.user.id;

    console.warn('🚌 [BUS_HOTEL_LOCATION] Marking location:', { type, scope, userId, connectionId });

    // Validate input
    if (!type || !scope || !locationData) {
      return res.status(400).json({ 
        success: false, 
        message: 'Type, scope, and locationData are required' 
      });
    }

    if (!['bus', 'hotel'].includes(type)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Type must be bus or hotel' 
      });
    }

    if (!['personal', 'group'].includes(scope)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Scope must be personal or group' 
      });
    }

    // Get connection and check user role
    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({ success: false, message: 'Connection not found' });
    }

    const userInConnection = connection.users.find(u => 
      u.userId.toString() === userId.toString() && u.status === 'active'
    );
    if (!userInConnection) {
      return res.status(403).json({ success: false, message: 'User not in this connection' });
    }

    const userRole = userInConnection.role;

    // Validate scope permissions
    if (scope === 'group' && userRole !== 'owner') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only owner can mark group locations' 
      });
    }

    if (scope === 'personal' && userRole === 'owner') {
      return res.status(403).json({ 
        success: false, 
        message: 'Owner cannot mark personal locations, use group instead' 
      });
    }

    // Prepare location data
    const locationUpdate = {
      name: locationData.name,
      address: locationData.address,
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      comment: locationData.comment || null,
      images: locationData.images || [],
      markedAt: new Date(),
      isActive: true
    };

    // Add room number for hotels
    if (type === 'hotel' && locationData.roomNo) {
      locationUpdate.roomNo = locationData.roomNo;
    }

    if (scope === 'group') {
      // Update group location in connection
      await Connection.findByIdAndUpdate(connectionId, {
        $set: {
          [`groupLocations.${type}`]: {
            ...locationUpdate,
            markedBy: userId
          }
        }
      });

      console.warn('🚌 [BUS_HOTEL_LOCATION] Group location marked');

    } else if (scope === 'personal') {
      // Update personal location in user
      await User.findByIdAndUpdate(userId, {
        $set: {
          [`personalLocations.${type}`]: {
            ...locationUpdate,
            source: 'personal'
          }
        }
      });

      console.warn('🚌 [BUS_HOTEL_LOCATION] Personal location marked');
    }

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      const roomName = `connection:${connectionId}`;
      
      // Convert local file URLs to server URLs for socket emission
      const socketLocationUpdate = { ...locationUpdate };
      if (socketLocationUpdate.images && Array.isArray(socketLocationUpdate.images)) {
        socketLocationUpdate.images = socketLocationUpdate.images.map(imgUrl => {
          if (imgUrl.startsWith('file://')) {
            // Extract filename from local path
            const filename = imgUrl.split('/').pop();
            return `/uploads/${filename}`;
          }
          return imgUrl;
        });
      }
      
      const eventData = {
        type,
        scope,
        userId,
        location: socketLocationUpdate,
        timestamp: new Date()
      };
      
      console.warn('🚌 [BUS_HOTEL_LOCATION] Emitting to room:', roomName);
      console.warn('🚌 [BUS_HOTEL_LOCATION] Original images:', locationUpdate.images);
      console.warn('🚌 [BUS_HOTEL_LOCATION] Socket images:', socketLocationUpdate.images);
      console.warn('🚌 [BUS_HOTEL_LOCATION] Event data:', JSON.stringify(eventData, null, 2));
      
      io.to(roomName).emit('locationMarked', eventData);
      console.warn('🚌 [BUS_HOTEL_LOCATION] Real-time update emitted to connection:', connectionId);
    } else {
      console.error('🚌 [BUS_HOTEL_LOCATION] IO instance not available!');
    }

    res.json({ success: true, message: 'Location marked successfully' });
  } catch (error) {
    console.error('❌ [BUS_HOTEL_LOCATION] Error marking location:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Remove a location (bus or hotel)
const removeLocation = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { type, scope } = req.body;
    const userId = req.user.id;

    console.warn('🚌 [BUS_HOTEL_LOCATION] Removing location:', { type, scope, userId, connectionId });

    // Validate input
    if (!type || !scope) {
      return res.status(400).json({ 
        success: false, 
        message: 'Type and scope are required' 
      });
    }

    if (!['bus', 'hotel'].includes(type)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Type must be bus or hotel' 
      });
    }

    if (!['personal', 'group'].includes(scope)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Scope must be personal or group' 
      });
    }

    // Get connection and check user role
    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({ success: false, message: 'Connection not found' });
    }

    const userInConnection = connection.users.find(u => 
      u.userId.toString() === userId.toString() && u.status === 'active'
    );
    if (!userInConnection) {
      return res.status(403).json({ success: false, message: 'User not in this connection' });
    }

    const userRole = userInConnection.role;

    // Validate scope permissions
    if (scope === 'group' && userRole !== 'owner') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only owner can remove group locations' 
      });
    }

    if (scope === 'personal' && userRole === 'owner') {
      return res.status(403).json({ 
        success: false, 
        message: 'Owner cannot remove personal locations, use group instead' 
      });
    }

    if (scope === 'group') {
      // Remove group location from connection by setting entire object to null
      console.warn('🚌 [BUS_HOTEL_LOCATION] Removing group location:', type);
      const connectionUpdate = await Connection.findByIdAndUpdate(connectionId, {
        $set: {
          [`groupLocations.${type}`]: null
        }
      });
      console.warn('🚌 [BUS_HOTEL_LOCATION] Connection update result:', connectionUpdate);

      // Remove owner's personal too
      console.warn('🚌 [BUS_HOTEL_LOCATION] Removing owner personal location:', type);
      const userUpdate = await User.findByIdAndUpdate(userId, {
        $set: {
          [`personalLocations.${type}`]: null
        }
      });
      console.warn('🚌 [BUS_HOTEL_LOCATION] User update result:', userUpdate);

      console.warn('🚌 [BUS_HOTEL_LOCATION] Group location removed and owner personal cleared');

      // Verify the deletion worked
      const verifyConnection = await Connection.findById(connectionId);
      const verifyUser = await User.findById(userId);
      console.warn('🚌 [BUS_HOTEL_LOCATION] Verification - Connection groupLocations:', verifyConnection.groupLocations);
      console.warn('🚌 [BUS_HOTEL_LOCATION] Verification - User personalLocations:', verifyUser.personalLocations);

    } else if (scope === 'personal') {
      // Remove personal location from user by setting entire object to null
      await User.findByIdAndUpdate(userId, {
        $set: {
          [`personalLocations.${type}`]: null
        }
      });

      // Sync back to group location if it exists
      const updatedConnection = await Connection.findById(connectionId);
      const groupLocation = updatedConnection.groupLocations?.[type];

      if (groupLocation) {
        await User.findByIdAndUpdate(userId, {
          $set: {
            [`personalLocations.${type}`]: {
              name: groupLocation.name,
              address: groupLocation.address,
              latitude: groupLocation.latitude,
              longitude: groupLocation.longitude,
              markedAt: new Date(),
              isActive: true,
              source: 'group'
            }
          }
        });
        console.warn('🚌 [BUS_HOTEL_LOCATION] Personal location removed and synced back to group');
      } else {
        console.warn('🚌 [BUS_HOTEL_LOCATION] Personal location removed, no group to sync back to');
      }
    }

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      const roomName = `connection:${connectionId}`;
      const eventData = {
        type,
        scope,
        userId,
        action: 'removed',
        timestamp: new Date()
      };
      
      console.warn('🚌 [BUS_HOTEL_LOCATION] Emitting removal to room:', roomName);
      console.warn('🚌 [BUS_HOTEL_LOCATION] Removal event data:', JSON.stringify(eventData, null, 2));
      
      io.to(roomName).emit('locationRemoved', eventData);
      console.warn('🚌 [BUS_HOTEL_LOCATION] Real-time removal emitted to connection:', connectionId);
    } else {
      console.error('🚌 [BUS_HOTEL_LOCATION] IO instance not available for removal!');
    }

    res.json({ success: true, message: 'Location removed successfully' });
  } catch (error) {
    console.error('❌ [BUS_HOTEL_LOCATION] Error removing location:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update a location (bus or hotel)
const updateLocation = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { type, scope, locationData } = req.body;
    const userId = req.user.id;

    console.warn('🚌 [BUS_HOTEL_LOCATION] Updating location:', { type, scope, userId, connectionId });

    // Validate input
    if (!type || !scope || !locationData) {
      return res.status(400).json({ 
        success: false, 
        message: 'Type, scope, and locationData are required' 
      });
    }

    // Get connection and check user role
    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({ success: false, message: 'Connection not found' });
    }

    const userInConnection = connection.users.find(u => 
      u.userId.toString() === userId.toString() && u.status === 'active'
    );
    if (!userInConnection) {
      return res.status(403).json({ success: false, message: 'User not in this connection' });
    }

    const userRole = userInConnection.role;

    // Validate scope permissions
    if (scope === 'group' && userRole !== 'owner') {
      return res.status(403).json({ 
        success: false, 
        message: 'Only owner can update group locations' 
      });
    }

    if (scope === 'personal' && userRole === 'owner') {
      return res.status(403).json({ 
        success: false, 
        message: 'Owner cannot update personal locations, use group instead' 
      });
    }

    // Prepare location data
    const locationUpdate = {
      name: locationData.name,
      address: locationData.address,
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      comment: locationData.comment || null,
      images: locationData.images || [],
      markedAt: new Date(),
      isActive: true
    };

    // Add room number for hotels
    if (type === 'hotel' && locationData.roomNo) {
      locationUpdate.roomNo = locationData.roomNo;
    }

    if (scope === 'group') {
      // Update group location in connection
      await Connection.findByIdAndUpdate(connectionId, {
        $set: {
          [`groupLocations.${type}`]: {
            ...locationUpdate,
            markedBy: userId
          }
        }
      });

      // Sync owner's personal with group
      await User.findByIdAndUpdate(userId, {
        $set: {
          [`personalLocations.${type}`]: {
            ...locationUpdate,
            source: 'group'
          }
        }
      });

      console.warn('🚌 [BUS_HOTEL_LOCATION] Group location updated and owner personal synced');

    } else if (scope === 'personal') {
      // Update personal location in user
      await User.findByIdAndUpdate(userId, {
        $set: {
          [`personalLocations.${type}`]: {
            ...locationUpdate,
            source: 'personal'
          }
        }
      });

      console.warn('🚌 [BUS_HOTEL_LOCATION] Personal location updated');
    }

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      const roomName = `connection:${connectionId}`;
      
      // Convert local file URLs to server URLs for socket emission
      const socketLocationUpdate = { ...locationUpdate };
      if (socketLocationUpdate.images && Array.isArray(socketLocationUpdate.images)) {
        socketLocationUpdate.images = socketLocationUpdate.images.map(imgUrl => {
          if (imgUrl.startsWith('file://')) {
            // Extract filename from local path
            const filename = imgUrl.split('/').pop();
            return `/uploads/${filename}`;
          }
          return imgUrl;
        });
      }
      
      const eventData = {
        type,
        scope,
        userId,
        location: socketLocationUpdate,
        action: 'updated',
        timestamp: new Date()
      };
      
      console.warn('🚌 [BUS_HOTEL_LOCATION] Emitting update to room:', roomName);
      console.warn('🚌 [BUS_HOTEL_LOCATION] Original images (update):', locationUpdate.images);
      console.warn('🚌 [BUS_HOTEL_LOCATION] Socket images (update):', socketLocationUpdate.images);
      console.warn('🚌 [BUS_HOTEL_LOCATION] Update event data:', JSON.stringify(eventData, null, 2));
      
      io.to(roomName).emit('locationUpdated', eventData);
      console.warn('🚌 [BUS_HOTEL_LOCATION] Real-time update emitted to connection:', connectionId);
    } else {
      console.error('🚌 [BUS_HOTEL_LOCATION] IO instance not available for update!');
    }

    res.json({ success: true, message: 'Location updated successfully' });
  } catch (error) {
    console.error('❌ [BUS_HOTEL_LOCATION] Error updating location:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get personal locations (no connection required)
const getPersonalLocations = async (req, res) => {
  try {
    const userId = req.user.id;
    console.warn('🚌 [PERSONAL_LOCATIONS] Getting personal locations for user:', userId);

    // Get user data
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Get personal locations
    const personalBus = user.personalLocations?.bus;
    const personalHotel = user.personalLocations?.hotel;

    console.warn('🚌 [PERSONAL_LOCATIONS] Personal locations retrieved:', {
      personalBus: personalBus ? '✅ Found' : '❌ Missing',
      personalHotel: personalHotel ? '✅ Found' : '❌ Missing',
    });

    const response = {
      success: true,
      data: {
        bus: personalBus,
        hotel: personalHotel,
        userRole: 'personal'
      }
    };

    console.warn('🚌 [PERSONAL_LOCATIONS] Personal locations retrieved successfully:', {
      bus: personalBus ? '✅ Found' : '❌ Missing',
      hotel: personalHotel ? '✅ Found' : '❌ Missing',
    });

    res.json(response);
  } catch (error) {
    console.error('🚌 [PERSONAL_LOCATIONS] Error getting personal locations:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Mark personal location (no connection required)
const markPersonalLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, name, latitude, longitude, comment, roomNo, images } = req.body;

    console.warn('🚌 [PERSONAL_MARK] Marking personal location:', { type, name, latitude, longitude });

    // Validate required fields
    if (!type || !name || !latitude || !longitude) {
      return res.status(400).json({ 
        success: false, 
        message: 'Type, name, latitude, and longitude are required' 
      });
    }

    if (!['bus', 'hotel'].includes(type)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Type must be either "bus" or "hotel"' 
      });
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Initialize personalLocations if it doesn't exist
    if (!user.personalLocations) {
      user.personalLocations = { bus: null, hotel: null };
    }

    // Create location data
    const locationData = {
      name,
      latitude,
      longitude,
      comment: comment || null,
      images: images || [],
      isActive: true,
      markedAt: new Date(),
      markedBy: userId
    };

    // Add room number for hotels
    if (type === 'hotel' && roomNo) {
      locationData.roomNo = roomNo;
    }

    // Update the specific location type
    user.personalLocations[type] = locationData;

    // Save user
    await user.save();

    console.warn('🚌 [PERSONAL_MARK] Personal location marked successfully:', locationData);

    res.json({
      success: true,
      message: 'Personal location marked successfully',
      data: locationData
    });
  } catch (error) {
    console.error('🚌 [PERSONAL_MARK] Error marking personal location:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update personal location (no connection required)
const updatePersonalLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, name, latitude, longitude, comment, roomNo, images } = req.body;

    console.warn('🚌 [PERSONAL_UPDATE] Updating personal location:', { type, name });

    // Validate required fields
    if (!type || !['bus', 'hotel'].includes(type)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid type (bus or hotel) is required' 
      });
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if personal location exists
    if (!user.personalLocations || !user.personalLocations[type]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Personal location not found' 
      });
    }

    // Update location data
    const currentLocation = user.personalLocations[type];
    user.personalLocations[type] = {
      ...currentLocation,
      name: name || currentLocation.name,
      latitude: latitude || currentLocation.latitude,
      longitude: longitude || currentLocation.longitude,
      comment: comment !== undefined ? comment : currentLocation.comment,
      images: images !== undefined ? images : currentLocation.images,
      updatedAt: new Date()
    };

    // Add room number for hotels
    if (type === 'hotel' && roomNo !== undefined) {
      user.personalLocations[type].roomNo = roomNo;
    }

    // Save user
    await user.save();

    console.warn('🚌 [PERSONAL_UPDATE] Personal location updated successfully');

    res.json({
      success: true,
      message: 'Personal location updated successfully',
      data: user.personalLocations[type]
    });
  } catch (error) {
    console.error('🚌 [PERSONAL_UPDATE] Error updating personal location:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Remove personal location (no connection required)
const removePersonalLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type } = req.body;

    console.warn('🚌 [PERSONAL_REMOVE] Removing personal location:', { type });

    // Validate required fields
    if (!type || !['bus', 'hotel'].includes(type)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid type (bus or hotel) is required' 
      });
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if personal location exists
    if (!user.personalLocations || !user.personalLocations[type]) {
      return res.status(404).json({ 
        success: false, 
        message: 'Personal location not found' 
      });
    }

    // Remove the location
    user.personalLocations[type] = null;

    // Save user
    await user.save();

    console.warn('🚌 [PERSONAL_REMOVE] Personal location removed successfully');

    res.json({
      success: true,
      message: 'Personal location removed successfully'
    });
  } catch (error) {
    console.error('🚌 [PERSONAL_REMOVE] Error removing personal location:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  getLocations,
  getPersonalLocations,
  markLocation,
  markPersonalLocation,
  removeLocation,
  removePersonalLocation,
  updateLocation,
  updatePersonalLocation
};
