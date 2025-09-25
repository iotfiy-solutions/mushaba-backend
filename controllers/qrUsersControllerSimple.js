// Simple QR Users Controller - without complex dependencies
const QRUsers = require('../models/QRUsers');
const User = require('../models/User');
const QRCode = require('qrcode');

// Get all QR users for current user
const getQRUsers = async (req, res) => {
  try {
    const userId = req.user.id;
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

    // Get hotel coordinates if available
    if (hotelData && hotelData.latitude && hotelData.longitude) {
      hotelCoordinates = {
        latitude: hotelData.latitude,
        longitude: hotelData.longitude
      };
      hotelAddress = 'Coordinates available'; // Will be converted to address on frontend
    }

    // Get bus coordinates if available
    if (busData && busData.latitude && busData.longitude) {
      busCoordinates = {
        latitude: busData.latitude,
        longitude: busData.longitude
      };
      busAddress = 'Coordinates available'; // Will be converted to address on frontend
    }

    res.json({
      success: true,
      userData: {
        name: user.name,
        phone: user.phone || '',
        hotelAddress,
        hotelCoordinates,
        busAddress,
        busCoordinates
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

    // Generate QR code as data URL
    let qrCodeDataURL;
    try {
      qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrContent), {
        type: 'image/png',
        quality: 0.92,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      console.warn('QR Code generated successfully, length:', qrCodeDataURL.length);
    } catch (error) {
      console.error('Error generating QR code:', error);
      // Fallback to JSON string if QR generation fails
      qrCodeDataURL = JSON.stringify(qrContent);
    }

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
      qrCode: qrCodeDataURL, // Store as data URL
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

    // Generate new QR code as data URL
    const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrContent), {
        type: 'image/png',
        quality: 0.92,
        margin: 1,
        color: {
          dark: '#000000',      // Black QR code
          light: '#FFFFFF'      // White background
        }
    });

    qrUser.qrCode = qrCodeDataURL;
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

// Update current user's QR data
const updateCurrentUserQR = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, roomNo, hotelAddress, hotelCoordinates, busAddress, busCoordinates, phone } = req.body;

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

    // Generate QR code as data URL
    const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrContent), {
        type: 'image/png',
        quality: 0.92,
        margin: 1,
        color: {
          dark: '#000000',      // Black QR code
          light: '#FFFFFF'      // White background
        }
    });

    qrUser.qrCode = qrCodeDataURL;
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
