const connections = require('../models/Connection');
const User = require('../models/User');
const { ConnectionLocation } = require('../models/Location');

// In-memory store for mesh network data (separate from existing locationController)
const meshUserLocations = {};

// 🚀 NEW: Database update function for mesh locations (similar to locationController)
const updateUserLocationInDatabase = async (userId, connectionId, locationData) => {
  console.log('[MESH_DB] Starting database update for user:', userId, 'connection:', connectionId);
  
  try {
    // Ensure the ConnectionLocation document exists
    const existingDoc = await ConnectionLocation.findOne({ connectionId: connectionId });
    
    if (!existingDoc) {
      // Create new document if it doesn't exist
      const connection = await connections.findById(connectionId);
      if (!connection) {
        throw new Error('Connection not found');
      }
      
      const newDoc = new ConnectionLocation({
        connectionId: connectionId,
        users: [],
        connectionStats: {
          activeUsers: 0,
          totalLocations: 0,
          lastActivity: new Date(),
          totalUsers: connection.users.length
        }
      });
      
      await newDoc.save();
      console.log('[MESH_DB] New ConnectionLocation document created:', newDoc._id);
    }
    
    // Update or insert user location in the connection document
    const updateResult = await ConnectionLocation.updateOne(
      { 
        connectionId: connectionId,
        'users.userId': userId 
      },
      {
        $set: {
          'users.$.currentLocation': {
            latitude: locationData.latitude,
            longitude: locationData.longitude,
            floor: locationData.floor || null,
            lastUpdated: new Date(),
            online: locationData.online || false
          },
          'users.$.stats.lastActive': new Date()
        },
        $push: {
          'users.$.locationHistory': {
            $each: [{
              latitude: locationData.latitude,
              longitude: locationData.longitude,
              floor: locationData.floor || null,
              timestamp: new Date(),
              accuracy: locationData.accuracy || null,
              speed: locationData.speed || null,
              heading: locationData.heading || null
            }],
            $slice: -10 // Keep only last 10 entries for mesh data
          }
        },
        $inc: {
          'users.$.stats.totalLocations': 1,
          'connectionStats.totalLocations': 1
        },
        $set: {
          'connectionStats.lastActivity': new Date()
        }
      }
    );
    
    // If user doesn't exist in the array, add them
    if (updateResult.matchedCount === 0) {
      console.log('[MESH_DB] User not found in connection, adding new user entry');
      
      await ConnectionLocation.updateOne(
        { connectionId: connectionId },
        {
          $push: {
            users: {
              userId: userId,
              currentLocation: {
                latitude: locationData.latitude,
                longitude: locationData.longitude,
                floor: locationData.floor || null,
                lastUpdated: new Date(),
                online: locationData.online || false
              },
              locationHistory: [{
                latitude: locationData.latitude,
                longitude: locationData.longitude,
                floor: locationData.floor || null,
                timestamp: new Date(),
                accuracy: locationData.accuracy || null,
                speed: locationData.speed || null,
                heading: locationData.heading || null
              }],
              stats: {
                totalLocations: 1,
                lastActive: new Date(),
                firstSeen: new Date()
              }
            }
          },
          $inc: {
            'connectionStats.activeUsers': 1,
            'connectionStats.totalLocations': 1
          },
          $set: {
            'connectionStats.lastActivity': new Date()
          }
        }
      );
    }
    
    console.log('[MESH_DB] Database update successful for user:', userId);
    
  } catch (error) {
    console.error('[MESH_DB] Database update error:', error);
    throw error;
  }
};

// POST /api/mesh/relay-offline-user
// Online user relays offline user's data to backend
exports.relayOfflineUserData = async (req, res) => {
  try {
    const { offlineUserId, latitude, longitude, floor, connectionId } = req.body;
    
    console.log('[MESH_RELAY] Received offline user data:', {
      offlineUserId,
      latitude,
      longitude,
      floor,
      connectionId
    });

    // Validate required fields
    if (!offlineUserId || typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: offlineUserId, latitude, longitude'
      });
    }

    // Update offline user's location in mesh storage (with floor)
    meshUserLocations[offlineUserId] = {
      latitude,
      longitude,
      floor: floor || null, // Optional floor, can be null
      lastUpdated: Date.now(),
      online: false // Mark as offline since this is relayed data
    };

    console.log('[MESH_RELAY] Updated mesh location for offline user:', offlineUserId);

    // 🚀 IMPROVED: Use connectionId from mesh data if provided, otherwise find user's connections
    let targetConnectionId = connectionId;
    let connection = null;
    
    if (targetConnectionId) {
      // Use the specific connectionId from mesh data
      console.log('[MESH_RELAY] Using connectionId from mesh data:', targetConnectionId);
      connection = await connections.findById(targetConnectionId);
    } else {
      // Fallback: Find the connection where this offline user is a member
      console.log('[MESH_RELAY] No connectionId provided, searching user connections...');
      const userConnections = await connections.findUserConnections(offlineUserId);
      if (userConnections && userConnections.length > 0) {
        connection = userConnections[0];
        targetConnectionId = connection._id;
      }
    }
    
    // 🚀 NEW: Also save to database for persistence
    try {
      if (connection && targetConnectionId) {
        
        console.log('[MESH_RELAY] Saving offline user location to database:', {
          offlineUserId,
          connectionId: targetConnectionId,
          latitude,
          longitude,
          floor
        });
        
        // Save to database using same method as regular location system
        await updateUserLocationInDatabase(offlineUserId, targetConnectionId, {
          latitude,
          longitude,
          floor: floor || null,
          online: false // Mark as offline
        });
        
        console.log('[MESH_RELAY] Successfully saved offline user location to database');
      }
    } catch (dbError) {
      console.error('[MESH_RELAY] Error saving to database:', dbError);
      // Continue with in-memory processing even if database save fails
    }
    
    if (!connection) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found for offline user'
      });
    }
    
    // Get all other users in this connection (excluding the offline user)
    const otherUsers = connection.users.filter(user => 
      user.userId.toString() !== offlineUserId
    );

    // Fetch locations for all other users in the connection
    const otherUsersLocations = [];
    
    for (const user of otherUsers) {
      const userId = user.userId.toString();
      
      // Try to get location from mesh storage first (for offline users)
      let userLocation = meshUserLocations[userId];
      
      // If not in mesh storage, try regular location storage
      if (!userLocation) {
        const locationController = require('./locationController');
        const regularLocations = locationController.getUserLocations();
        userLocation = regularLocations[userId];
      }

      if (userLocation) {
        // Get user details
        const userDetails = await User.findById(userId).lean();
        
        otherUsersLocations.push({
          userId: userId,
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          floor: userLocation.floor || null // Include floor if available
        });
      }
    }

    console.log('[MESH_RELAY] Returning locations for offline user:', {
      offlineUserId,
      otherUsersCount: otherUsersLocations.length
    });

    // Return the data for the online user to send back to offline user
    return res.json({
      success: true,
      offlineUserId: offlineUserId,
      otherUsers: otherUsersLocations
    });

  } catch (error) {
    console.error('[MESH_RELAY] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error processing mesh relay'
    });
  }
};

// POST /api/mesh/offline-user-response
// Store response data received from mesh network for offline user
exports.handleOfflineUserResponse = async (req, res) => {
  try {
    const { offlineUserId, responseData } = req.body;
    
    console.log('[MESH_RESPONSE] Storing response for offline user:', offlineUserId);

    // Store the response data (this could be used when offline user comes back online)
    // For now, we'll just acknowledge receipt
    // In the future, this could be stored in a temporary cache or database
    
    return res.json({
      success: true,
      message: 'Response data received for offline user'
    });

  } catch (error) {
    console.error('[MESH_RESPONSE] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error processing offline user response'
    });
  }
};

// GET /api/mesh/locations
// Get all mesh network locations (for debugging/admin purposes)
exports.getMeshLocations = async (req, res) => {
  try {
    return res.json({
      success: true,
      meshLocations: meshUserLocations
    });
  } catch (error) {
    console.error('[MESH_LOCATIONS] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error getting mesh locations'
    });
  }
};

// Expose meshUserLocations for potential future use
exports.getMeshUserLocations = () => meshUserLocations; 