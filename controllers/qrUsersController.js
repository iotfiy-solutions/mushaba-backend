const QRUsers = require('../models/QRUsers');
const User = require('../models/User');
const reverseGeocodingService = require('../services/reverseGeocodingService');
const QRCode = require('qrcode');

/**
 * QR Users Controller
 * Handles CRUD operations for QR users management
 */

// Get all QR users for current user (including current user's data)
const getQRUsers = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all QR users for this user
    const qrUsers = await QRUsers.find({ userId }).sort({ isCurrentUser: -1, createdAt: -1 });

    res.json({
      success: true,
      users: qrUsers
    });
  } catch (error) {
    console.error('Error fetching QR users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch QR users',
      error: error.message
    });
  }
};

// Get current user's data for QR creation
const getCurrentUserData = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get current user with their marked locations
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Extract hotel and bus data
    const hotelData = user.activeLocations?.hotel;
    const busData = user.activeLocations?.busStation;

    let hotelAddress = 'Not specified';
    let busAddress = 'Not specified';
    let hotelCoordinates = null;
    let busCoordinates = null;

    // Get hotel address if available
    if (hotelData && hotelData.latitude && hotelData.longitude) {
      hotelCoordinates = {
        latitude: hotelData.latitude,
        longitude: hotelData.longitude
      };
      hotelAddress = await reverseGeocodingService.getAddressFromCoordinates(
        hotelData.latitude, 
        hotelData.longitude
      );
    }

    // Get bus address if available
    if (busData && busData.latitude && busData.longitude) {
      busCoordinates = {
        latitude: busData.latitude,
        longitude: busData.longitude
      };
      busAddress = await reverseGeocodingService.getAddressFromCoordinates(
        busData.latitude, 
        busData.longitude
      );
    }

    // Generate fresh QR code for current user with latest data
    let qrCodeDataURL = null;
    try {
      const qrContent = {
        name: user.name,
        roomNo: 'N/A', // Default room number for current user
        hotelAddress,
        hotelCoordinates,
        busAddress,
        busCoordinates,
        phone: user.phone || ''
      };

      qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrContent), {
        type: 'image/png',
        quality: 0.92,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
    } catch (error) {
      console.error('Error generating current user QR code:', error);
      // Fallback to JSON string if QR generation fails
      qrCodeDataURL = JSON.stringify({
        name: user.name,
        roomNo: 'N/A',
        hotelAddress,
        hotelCoordinates,
        busAddress,
        busCoordinates,
        phone: user.phone || ''
      });
    }

    res.json({
      success: true,
      userData: {
        name: user.name,
        phone: user.phone || '',
        hotelAddress,
        hotelCoordinates,
        busAddress,
        busCoordinates,
        qrCode: qrCodeDataURL // Include fresh QR code
      }
    });
  } catch (error) {
    console.error('Error fetching current user data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch current user data',
      error: error.message
    });
  }
};

// Create new QR user
const createQRUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, roomNo, hotelAddress, hotelCoordinates, busAddress, busCoordinates, phone } = req.body;

    // Validate required fields
    if (!name || !roomNo || !hotelAddress || !busAddress) {
      return res.status(400).json({
        success: false,
        message: 'Name, room number, hotel address, and bus address are required'
      });
    }

    // Create QR code content
    const qrContent = {
      name,
      roomNo,
      hotelAddress,
      hotelCoordinates,
      busAddress,
      busCoordinates,
      phone: phone || ''
    };

    // Generate QR code
    const qrCode = await QRCode.toDataURL(JSON.stringify(qrContent), {
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // Create QR user
    const qrUser = new QRUsers({
      userId,
      name,
      roomNo,
      hotelAddress,
      hotelCoordinates,
      busAddress,
      busCoordinates,
      phone: phone || '',
      qrCode,
      isCurrentUser: false
    });

    await qrUser.save();

    res.json({
      success: true,
      message: 'QR user created successfully',
      user: qrUser
    });
  } catch (error) {
    console.error('Error creating QR user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create QR user',
      error: error.message
    });
  }
};

// Update QR user
const updateQRUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const { qrUserId } = req.params;
    const { name, roomNo, hotelAddress, hotelCoordinates, busAddress, busCoordinates, phone } = req.body;

    // Find the QR user
    const qrUser = await QRUsers.findOne({ _id: qrUserId, userId });
    
    if (!qrUser) {
      return res.status(404).json({
        success: false,
        message: 'QR user not found'
      });
    }

    // Update fields
    if (name) qrUser.name = name;
    if (roomNo) qrUser.roomNo = roomNo;
    if (hotelAddress) qrUser.hotelAddress = hotelAddress;
    if (hotelCoordinates) qrUser.hotelCoordinates = hotelCoordinates;
    if (busAddress) qrUser.busAddress = busAddress;
    if (busCoordinates) qrUser.busCoordinates = busCoordinates;
    if (phone !== undefined) qrUser.phone = phone;

    // Regenerate QR code with updated data
    const qrContent = {
      name: qrUser.name,
      roomNo: qrUser.roomNo,
      hotelAddress: qrUser.hotelAddress,
      hotelCoordinates: qrUser.hotelCoordinates,
      busAddress: qrUser.busAddress,
      busCoordinates: qrUser.busCoordinates,
      phone: qrUser.phone
    };

    qrUser.qrCode = await QRCode.toDataURL(JSON.stringify(qrContent), {
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    await qrUser.save();

    res.json({
      success: true,
      message: 'QR user updated successfully',
      user: qrUser
    });
  } catch (error) {
    console.error('Error updating QR user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update QR user',
      error: error.message
    });
  }
};

// Delete QR user
const deleteQRUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const { qrUserId } = req.params;

    // Find and delete the QR user
    const qrUser = await QRUsers.findOneAndDelete({ _id: qrUserId, userId });
    
    if (!qrUser) {
      return res.status(404).json({
        success: false,
        message: 'QR user not found'
      });
    }

    res.json({
      success: true,
      message: 'QR user deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting QR user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete QR user',
      error: error.message
    });
  }
};

// Create/Update current user's QR data
const updateCurrentUserQR = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, roomNo, hotelAddress, hotelCoordinates, busAddress, busCoordinates, phone, qrCode } = req.body;

    // Find existing current user QR data
    let qrUser = await QRUsers.findOne({ userId, isCurrentUser: true });

    if (qrUser) {
      // Update existing
      qrUser.name = name;
      qrUser.roomNo = roomNo;
      qrUser.hotelAddress = hotelAddress;
      qrUser.hotelCoordinates = hotelCoordinates;
      qrUser.busAddress = busAddress;
      qrUser.busCoordinates = busCoordinates;
      qrUser.phone = phone || '';
    } else {
      // Create new
      qrUser = new QRUsers({
        userId,
        name,
        roomNo,
        hotelAddress,
        hotelCoordinates,
        busAddress,
        busCoordinates,
        phone: phone || '',
        isCurrentUser: true
      });
    }

    // Use provided QR code or generate new one
    if (qrCode) {
      qrUser.qrCode = qrCode;
    } else {
      // Generate QR code
      const qrContent = {
        name: qrUser.name,
        roomNo: qrUser.roomNo,
        hotelAddress: qrUser.hotelAddress,
        hotelCoordinates: qrUser.hotelCoordinates,
        busAddress: qrUser.busAddress,
        busCoordinates: qrUser.busCoordinates,
        phone: qrUser.phone
      };

      qrUser.qrCode = await QRCode.toDataURL(JSON.stringify(qrContent), {
        type: 'image/png',
        quality: 0.92,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
    }

    await qrUser.save();

    res.json({
      success: true,
      message: 'Current user QR data updated successfully',
      user: qrUser
    });
  } catch (error) {
    console.error('Error updating current user QR:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update current user QR data',
      error: error.message
    });
  }
};

module.exports = {
  getQRUsers,
  getCurrentUserData,
  createQRUser,
  updateQRUser,
  deleteQRUser,
  updateCurrentUserQR
};
