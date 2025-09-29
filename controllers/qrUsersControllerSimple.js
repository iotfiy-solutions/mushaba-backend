// Enhanced QR Users Controller with geoservice integration
const QRUsers = require('../models/QRUsers');
const User = require('../models/User');
const QRCode = require('qrcode');
const reverseGeocodingService = require('../services/reverseGeocodingService');

// Get all QR users for current user
const getQRUsers = async (req, res) => {
  try {
    const userId = req.user.id;
    const qrUsers = await QRUsers.find({ userId }).sort({ isCurrentUser: -1, createdAt: -1 });
    
    // Convert coordinates to English addresses for all users
    const usersWithAddresses = await Promise.all(
      qrUsers.map(async (user) => {
        let hotelAddress = user.hotelAddress;
        let busAddress = user.busAddress;

        // Convert hotel coordinates to address if we have coordinates
        if (user.hotelCoordinates && user.hotelCoordinates.latitude !== 0 && user.hotelCoordinates.longitude !== 0) {
          try {
            hotelAddress = await reverseGeocodingService.getAddressFromCoordinates(
              user.hotelCoordinates.latitude, 
              user.hotelCoordinates.longitude
            );
          } catch (error) {
            console.error('Error converting hotel coordinates for user:', user.name, error);
          }
        }

        // Convert bus coordinates to address if we have coordinates
        if (user.busCoordinates && user.busCoordinates.latitude !== 0 && user.busCoordinates.longitude !== 0) {
          try {
            busAddress = await reverseGeocodingService.getAddressFromCoordinates(
              user.busCoordinates.latitude, 
              user.busCoordinates.longitude
            );
          } catch (error) {
            console.error('Error converting bus coordinates for user:', user.name, error);
          }
        }

        return {
          ...user.toObject(),
          hotelAddress,
          busAddress,
          // Frontend compatibility
          hotelLocation: hotelAddress,
          busStation: busAddress,
          contactNo: user.phone || ''
        };
      })
    );
    
    res.json({
      success: true,
      users: usersWithAddresses
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

// Get current user's data for QR creation with priority system
const getCurrentUserData = async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('🔍 [CURRENT_USER_DATA] Starting getCurrentUserData for userId:', userId);
    
    const user = await User.findById(userId);
    console.log('🔍 [CURRENT_USER_DATA] User found:', !!user);
    console.log('🔍 [CURRENT_USER_DATA] User data:', {
      name: user?.name,
      phone: user?.phone,
      personalLocations: user?.personalLocations,
      activeLocations: user?.activeLocations
    });

    if (!user) {
      console.log('❌ [CURRENT_USER_DATA] User not found');
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // PRIORITY SYSTEM: Check multiple sources for location data
    let hotelAddress = 'Not specified';
    let hotelCoordinates = { latitude: 0, longitude: 0 };
    let busAddress = 'Not specified';
    let busCoordinates = { latitude: 0, longitude: 0 };

    console.log('🔍 [CURRENT_USER_DATA] Starting priority system...');

    // PRIORITY 1: Check personal marked locations (highest priority)
    const personalHotel = user.personalLocations?.hotel;
    const personalBus = user.personalLocations?.bus;
    console.log('🔍 [CURRENT_USER_DATA] Personal locations:', {
      hotel: personalHotel,
      bus: personalBus
    });

    if (personalHotel && personalHotel.latitude && personalHotel.longitude) {
      hotelCoordinates = {
        latitude: personalHotel.latitude,
        longitude: personalHotel.longitude
      };
      hotelAddress = personalHotel.name || 'Personal Hotel Location';
      console.log('✅ [CURRENT_USER_DATA] Using personal hotel location:', hotelAddress);
    }

    if (personalBus && personalBus.latitude && personalBus.longitude) {
      busCoordinates = {
        latitude: personalBus.latitude,
        longitude: personalBus.longitude
      };
      busAddress = personalBus.name || 'Personal Bus Location';
      console.log('✅ [CURRENT_USER_DATA] Using personal bus location:', busAddress);
    }

    // PRIORITY 2: Check activeLocations (fallback)
    console.log('🔍 [CURRENT_USER_DATA] Checking active locations...');
    if (hotelAddress === 'Not specified') {
      const activeHotel = user.activeLocations?.hotel;
      console.log('🔍 [CURRENT_USER_DATA] Active hotel:', activeHotel);
      if (activeHotel && activeHotel.latitude && activeHotel.longitude) {
        hotelCoordinates = {
          latitude: activeHotel.latitude,
          longitude: activeHotel.longitude
        };
        hotelAddress = activeHotel.name || 'Active Hotel Location';
        console.log('✅ [CURRENT_USER_DATA] Using active hotel location:', hotelAddress);
      }
    }

    if (busAddress === 'Not specified') {
      const activeBus = user.activeLocations?.busStation;
      console.log('🔍 [CURRENT_USER_DATA] Active bus:', activeBus);
      if (activeBus && activeBus.latitude && activeBus.longitude) {
        busCoordinates = {
          latitude: activeBus.latitude,
          longitude: activeBus.longitude
        };
        busAddress = activeBus.name || 'Active Bus Location';
        console.log('✅ [CURRENT_USER_DATA] Using active bus location:', busAddress);
      }
    }

    // PRIORITY 3: Check QR collection data (lowest priority)
    console.log('🔍 [CURRENT_USER_DATA] Checking QR collection data...');
    if (hotelAddress === 'Not specified' || busAddress === 'Not specified') {
      const qrUser = await QRUsers.findOne({ userId, isCurrentUser: true });
      console.log('🔍 [CURRENT_USER_DATA] QR user found:', !!qrUser);
      if (qrUser) {
        console.log('🔍 [CURRENT_USER_DATA] QR user data:', {
          hotelAddress: qrUser.hotelAddress,
          busAddress: qrUser.busAddress
        });
        if (hotelAddress === 'Not specified' && qrUser.hotelAddress && qrUser.hotelAddress !== 'Not specified') {
          hotelAddress = qrUser.hotelAddress;
          hotelCoordinates = qrUser.hotelCoordinates || { latitude: 0, longitude: 0 };
          console.log('✅ [CURRENT_USER_DATA] Using QR hotel data:', hotelAddress);
        }
        if (busAddress === 'Not specified' && qrUser.busAddress && qrUser.busAddress !== 'Not specified') {
          busAddress = qrUser.busAddress;
          busCoordinates = qrUser.busCoordinates || { latitude: 0, longitude: 0 };
          console.log('✅ [CURRENT_USER_DATA] Using QR bus data:', busAddress);
        }
      }
    }

    console.log('🔍 [CURRENT_USER_DATA] Final addresses before conversion:', {
      hotelAddress,
      busAddress
    });

    // Convert coordinates to English addresses for display
    let finalHotelAddress = hotelAddress;
    let finalBusAddress = busAddress;

    // Convert hotel coordinates to address if we have coordinates
    if (hotelCoordinates && hotelCoordinates.latitude !== 0 && hotelCoordinates.longitude !== 0) {
      try {
        finalHotelAddress = await reverseGeocodingService.getAddressFromCoordinates(
          hotelCoordinates.latitude, 
          hotelCoordinates.longitude
        );
        console.log('✅ [CURRENT_USER_DATA] Converted hotel coordinates to address:', finalHotelAddress);
      } catch (error) {
        console.error('❌ [CURRENT_USER_DATA] Error converting hotel coordinates to address:', error);
      }
    }

    // Convert bus coordinates to address if we have coordinates
    if (busCoordinates && busCoordinates.latitude !== 0 && busCoordinates.longitude !== 0) {
      try {
        finalBusAddress = await reverseGeocodingService.getAddressFromCoordinates(
          busCoordinates.latitude, 
          busCoordinates.longitude
        );
        console.log('✅ [CURRENT_USER_DATA] Converted bus coordinates to address:', finalBusAddress);
      } catch (error) {
        console.error('❌ [CURRENT_USER_DATA] Error converting bus coordinates to address:', error);
      }
    }

    // Get room number from personal locations
    let roomNumber = 'Not specified';
    if (personalHotel && personalHotel.roomNo) {
      roomNumber = personalHotel.roomNo;
      console.log('✅ [CURRENT_USER_DATA] Using personal hotel room number:', roomNumber);
    }

    // Get hotel name/comment from personal locations
    let hotelName = 'Not specified';
    if (personalHotel && personalHotel.comment) {
      hotelName = personalHotel.comment;
      console.log('✅ [CURRENT_USER_DATA] Using personal hotel comment/name:', hotelName);
    }

    // Get bus name/comment from personal locations
    let busName = 'Not specified';
    if (personalBus && personalBus.comment) {
      busName = personalBus.comment;
      console.log('✅ [CURRENT_USER_DATA] Using personal bus comment/name:', busName);
    }

    // PHONE NUMBER PRIORITY SYSTEM
    // Priority 1: Check if phone number is provided in form fields (highest priority)
    // Priority 2: Use current user's phone number (fallback)
    let finalPhone = user.phone || '';
    console.log('🔍 [CURRENT_USER_DATA] Phone priority - User phone:', user.phone);
    console.log('🔍 [CURRENT_USER_DATA] Phone priority - Final phone:', finalPhone);

    const responseData = {
      name: user.name,
      phone: finalPhone,
      roomNo: roomNumber,
      hotelAddress: finalHotelAddress,
      hotelName: hotelName,
      hotelCoordinates,
      busAddress: finalBusAddress,
      busName: busName,
      busCoordinates,
      // Frontend compatibility - add alternative field names
      hotelLocation: finalHotelAddress,
      busStation: finalBusAddress,
      contactNo: finalPhone
    };

    console.log('🔍 [CURRENT_USER_DATA] Final response data:', responseData);

    res.json({
      success: true,
      userData: responseData
    });
  } catch (error) {
    console.error('❌ [CURRENT_USER_DATA] Error fetching current user data:', error);
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
    console.log('🔍 [CREATE_QR] Starting createQRUser for userId:', userId);
    
    const { 
      name, 
      roomNo, 
      hotelAddress, 
      hotelLocation, // Frontend compatibility
      hotelCoordinates, 
      busAddress, 
      busStation, // Frontend compatibility
      busCoordinates, 
      phone,
      contactNo // Frontend compatibility
    } = req.body;

    console.log('🔍 [CREATE_QR] Raw request body:', req.body);
    console.log('🔍 [CREATE_QR] Extracted data:', {
      name, 
      roomNo, 
      hotelAddress, 
      hotelLocation,
      hotelCoordinates, 
      busAddress, 
      busStation,
      busCoordinates, 
      phone,
      contactNo
    });

    // Use frontend field names if backend field names are not provided
    const finalHotelAddress = hotelAddress || hotelLocation || 'Not specified';
    const finalBusAddress = busAddress || busStation || 'Not specified';
    
    // PHONE NUMBER PRIORITY SYSTEM
    // Priority 1: Phone number from form fields (highest priority)
    // Priority 2: Current user's phone number (fallback)
    let finalPhone = phone || contactNo || '';
    
    // If no phone provided in form, get current user's phone
    if (!finalPhone) {
      const currentUser = await User.findById(userId);
      finalPhone = currentUser?.phone || '';
      console.log('🔍 [CREATE_QR] No phone in form, using current user phone:', finalPhone);
    } else {
      console.log('🔍 [CREATE_QR] Using phone from form fields:', finalPhone);
    }

    console.log('🔍 [CREATE_QR] Processed data:', {
      finalHotelAddress, 
      finalBusAddress, 
      finalPhone,
      roomNo
    });

    // Validate required fields
    if (!name || !roomNo) {
      return res.status(400).json({
        success: false,
        message: 'Name and room number are required'
      });
    }

    // Handle address conversion - if address is provided, convert to coordinates
    let finalHotelCoordinates = hotelCoordinates || { latitude: 0, longitude: 0 };
    let finalBusCoordinates = busCoordinates || { latitude: 0, longitude: 0 };

    // If hotel address is provided and no coordinates, geocode it
    if (hotelAddress && hotelAddress !== 'Not specified' && (!hotelCoordinates || hotelCoordinates.latitude === 0)) {
      try {
        finalHotelCoordinates = await reverseGeocodingService.getCoordinatesFromAddress(hotelAddress);
        console.log('Geocoded hotel address:', hotelAddress, 'to coordinates:', finalHotelCoordinates);
      } catch (error) {
        console.error('Error geocoding hotel address:', error);
        finalHotelCoordinates = { latitude: 0, longitude: 0 };
      }
    }

    // If bus address is provided and no coordinates, geocode it
    if (busAddress && busAddress !== 'Not specified' && (!busCoordinates || busCoordinates.latitude === 0)) {
      try {
        finalBusCoordinates = await reverseGeocodingService.getCoordinatesFromAddress(busAddress);
        console.log('Geocoded bus address:', busAddress, 'to coordinates:', finalBusCoordinates);
      } catch (error) {
        console.error('Error geocoding bus address:', error);
        finalBusCoordinates = { latitude: 0, longitude: 0 };
      }
    }

    // Create QR code content with URL - use local IP for testing
    const qrUrl = `https://mushaba.iotfiysolutions.com/qr/${userId}`;
    const qrContent = {
      name,
      roomNo,
      hotelAddress: finalHotelAddress,
      hotelCoordinates: finalHotelCoordinates,
      busAddress: finalBusAddress,
      busCoordinates: finalBusCoordinates,
      phone: finalPhone,
      url: qrUrl
    };

    // Generate QR code as data URL - use URL for direct access
    let qrCodeDataURL;
    try {
      // Generate QR code with just the URL for direct access
      qrCodeDataURL = await QRCode.toDataURL(qrUrl, {
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
      // Fallback to URL string if QR generation fails
      qrCodeDataURL = qrUrl;
    }

    // Create QR user
    const qrUserData = {
      userId,
      name,
      roomNo,
      hotelAddress: finalHotelAddress,
      hotelName: finalHotelAddress, // Use address as name for now
      hotelCoordinates: finalHotelCoordinates,
      busAddress: finalBusAddress,
      busName: finalBusAddress, // Use address as name for now
      busCoordinates: finalBusCoordinates,
      phone: finalPhone,
      qrCode: qrCodeDataURL, // Store as data URL
      isCurrentUser: false
    };

    console.log('🔍 [CREATE_QR] Creating QR user with data:', qrUserData);

    const qrUser = new QRUsers(qrUserData);

    console.log('🔍 [CREATE_QR] QR user object created:', {
      name: qrUser.name,
      roomNo: qrUser.roomNo,
      phone: qrUser.phone,
      hotelAddress: qrUser.hotelAddress,
      busAddress: qrUser.busAddress
    });

    await qrUser.save();
    console.log('✅ [CREATE_QR] QR user saved successfully');

    const savedUser = await QRUsers.findById(qrUser._id);
    console.log('🔍 [CREATE_QR] Saved user from database:', {
      name: savedUser.name,
      roomNo: savedUser.roomNo,
      phone: savedUser.phone,
      hotelAddress: savedUser.hotelAddress,
      busAddress: savedUser.busAddress
    });

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
        const { name, roomNo, hotelAddress, hotelCoordinates, busAddress, busCoordinates, phone, contactNo } = req.body;

    // Find the QR user
    const qrUser = await QRUsers.findOne({ _id: qrUserId, userId });
    
    if (!qrUser) {
      return res.status(404).json({
        success: false,
        message: 'QR user not found'
      });
    }

    // Handle address conversion - if address is provided, convert to coordinates
    let finalHotelAddress = qrUser.hotelAddress;
    let finalHotelCoordinates = qrUser.hotelCoordinates;
    let finalBusAddress = qrUser.busAddress;
    let finalBusCoordinates = qrUser.busCoordinates;

    // Update hotel data
    if (hotelAddress !== undefined) {
      finalHotelAddress = hotelAddress;
      if (hotelAddress && hotelAddress !== 'Not specified' && (!hotelCoordinates || hotelCoordinates.latitude === 0)) {
        try {
          finalHotelCoordinates = await reverseGeocodingService.getCoordinatesFromAddress(hotelAddress);
          console.log('Geocoded hotel address:', hotelAddress, 'to coordinates:', finalHotelCoordinates);
        } catch (error) {
          console.error('Error geocoding hotel address:', error);
          finalHotelCoordinates = { latitude: 0, longitude: 0 };
        }
      } else if (hotelCoordinates) {
        finalHotelCoordinates = hotelCoordinates;
      }
    }

    // Update bus data
    if (busAddress !== undefined) {
      finalBusAddress = busAddress;
      if (busAddress && busAddress !== 'Not specified' && (!busCoordinates || busCoordinates.latitude === 0)) {
        try {
          finalBusCoordinates = await reverseGeocodingService.getCoordinatesFromAddress(busAddress);
          console.log('Geocoded bus address:', busAddress, 'to coordinates:', finalBusCoordinates);
        } catch (error) {
          console.error('Error geocoding bus address:', error);
          finalBusCoordinates = { latitude: 0, longitude: 0 };
        }
      } else if (busCoordinates) {
        finalBusCoordinates = busCoordinates;
      }
    }

    // PHONE NUMBER PRIORITY SYSTEM
    let finalPhone = phone || contactNo || '';
    
    // If no phone provided in form, get current user's phone
    if (!finalPhone) {
      const currentUser = await User.findById(userId);
      finalPhone = currentUser?.phone || '';
      console.log('🔍 [UPDATE_QR] No phone in form, using current user phone:', finalPhone);
    } else {
      console.log('🔍 [UPDATE_QR] Using phone from form fields:', finalPhone);
    }

    // Update fields
    if (name) qrUser.name = name;
    if (roomNo) qrUser.roomNo = roomNo;
    qrUser.hotelAddress = finalHotelAddress;
    qrUser.hotelCoordinates = finalHotelCoordinates;
    qrUser.busAddress = finalBusAddress;
    qrUser.busCoordinates = finalBusCoordinates;
    qrUser.phone = finalPhone;

    // Regenerate QR code with updated data - use local IP for testing
    const qrUrl = `https://mushaba.iotfiysolutions.com/qr/${userId}`;
    const qrContent = {
      name: qrUser.name,
      roomNo: qrUser.roomNo,
      hotelAddress: qrUser.hotelAddress,
      hotelCoordinates: qrUser.hotelCoordinates,
      busAddress: qrUser.busAddress,
      busCoordinates: qrUser.busCoordinates,
      phone: qrUser.phone,
      url: qrUrl
    };

    // Generate new QR code as data URL - use URL for direct access
    const qrCodeDataURL = await QRCode.toDataURL(qrUrl, {
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
    const { name, roomNo, hotelAddress, hotelCoordinates, busAddress, busCoordinates, phone, contactNo } = req.body;

    // Handle address conversion - if address is provided, convert to coordinates
    let finalHotelAddress = hotelAddress || 'Not specified';
    let finalHotelCoordinates = hotelCoordinates || { latitude: 0, longitude: 0 };
    let finalBusAddress = busAddress || 'Not specified';
    let finalBusCoordinates = busCoordinates || { latitude: 0, longitude: 0 };

    // If hotel address is provided and no coordinates, geocode it
    if (hotelAddress && hotelAddress !== 'Not specified' && (!hotelCoordinates || hotelCoordinates.latitude === 0)) {
      try {
        finalHotelCoordinates = await reverseGeocodingService.getCoordinatesFromAddress(hotelAddress);
        console.log('Geocoded hotel address:', hotelAddress, 'to coordinates:', finalHotelCoordinates);
      } catch (error) {
        console.error('Error geocoding hotel address:', error);
        finalHotelCoordinates = { latitude: 0, longitude: 0 };
      }
    }

    // If bus address is provided and no coordinates, geocode it
    if (busAddress && busAddress !== 'Not specified' && (!busCoordinates || busCoordinates.latitude === 0)) {
      try {
        finalBusCoordinates = await reverseGeocodingService.getCoordinatesFromAddress(busAddress);
        console.log('Geocoded bus address:', busAddress, 'to coordinates:', finalBusCoordinates);
      } catch (error) {
        console.error('Error geocoding bus address:', error);
        finalBusCoordinates = { latitude: 0, longitude: 0 };
      }
    }

    // PHONE NUMBER PRIORITY SYSTEM
    let finalPhone = phone || contactNo || '';
    
    // If no phone provided in form, get current user's phone
    if (!finalPhone) {
      const currentUser = await User.findById(userId);
      finalPhone = currentUser?.phone || '';
      console.log('🔍 [UPDATE_CURRENT_QR] No phone in form, using current user phone:', finalPhone);
    } else {
      console.log('🔍 [UPDATE_CURRENT_QR] Using phone from form fields:', finalPhone);
    }

    // Find existing current user QR data
    let qrUser = await QRUsers.findOne({ userId, isCurrentUser: true });

    if (qrUser) {
      // Update existing
      qrUser.name = name;
      qrUser.roomNo = roomNo;
      qrUser.hotelAddress = finalHotelAddress;
      qrUser.hotelCoordinates = finalHotelCoordinates;
      qrUser.busAddress = finalBusAddress;
      qrUser.busCoordinates = finalBusCoordinates;
      qrUser.phone = finalPhone;
    } else {
      // Create new
      qrUser = new QRUsers({
        userId,
        name,
        roomNo,
        hotelAddress: finalHotelAddress,
        hotelCoordinates: finalHotelCoordinates,
        busAddress: finalBusAddress,
        busCoordinates: finalBusCoordinates,
        phone: finalPhone,
        isCurrentUser: true
      });
    }

    // Generate QR code - use local IP for testing
    const qrUrl = `https://mushaba.iotfiysolutions.com/qr/${userId}`;
    const qrContent = {
      name: qrUser.name,
      roomNo: qrUser.roomNo,
      hotelAddress: qrUser.hotelAddress,
      hotelCoordinates: qrUser.hotelCoordinates,
      busAddress: qrUser.busAddress,
      busCoordinates: qrUser.busCoordinates,
      phone: qrUser.phone,
      url: qrUrl
    };

    // Generate QR code as data URL - use URL for direct access
    const qrCodeDataURL = await QRCode.toDataURL(qrUrl, {
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

// Get QR user data as HTML page
const getQRUserHTML = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('🔍 [QR_HTML] Starting getQRUserHTML for userId:', userId);
    
    // Find QR user by userId - get the most recent one (not necessarily current user)
    const qrUser = await QRUsers.findOne({ userId }).sort({ createdAt: -1 });
    console.log('🔍 [QR_HTML] QR User found:', !!qrUser);
    
    // Debug: Check all QR users for this userId
    const allQRUsers = await QRUsers.find({ userId }).sort({ createdAt: -1 });
    console.log('🔍 [QR_HTML] All QR users for userId:', allQRUsers.length);
    allQRUsers.forEach((user, index) => {
      console.log(`🔍 [QR_HTML] QR User ${index + 1}:`, {
        name: user.name,
        roomNo: user.roomNo,
        phone: user.phone,
        isCurrentUser: user.isCurrentUser,
        createdAt: user.createdAt
      });
    });
    
    if (!qrUser) {
      console.log('❌ [QR_HTML] QR User not found for userId:', userId);
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>QR User Not Found</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .error { color: #e74c3c; }
          </style>
        </head>
        <body>
          <h1 class="error">QR User Not Found</h1>
          <p>The requested QR user data could not be found.</p>
        </body>
        </html>
      `);
    }

    console.log('🔍 [QR_HTML] QR User data from database:', {
      name: qrUser.name,
      roomNo: qrUser.roomNo,
      phone: qrUser.phone,
      hotelAddress: qrUser.hotelAddress,
      busAddress: qrUser.busAddress,
      hotelCoordinates: qrUser.hotelCoordinates,
      busCoordinates: qrUser.busCoordinates
    });

    // Always convert coordinates to English addresses for display
    let hotelAddress = qrUser.hotelAddress;
    let busAddress = qrUser.busAddress;

    console.log('🔍 [QR_HTML] Initial addresses:', {
      hotelAddress,
      busAddress
    });

    // If we have coordinates, always convert them to English addresses
    if (qrUser.hotelCoordinates && qrUser.hotelCoordinates.latitude !== 0 && qrUser.hotelCoordinates.longitude !== 0) {
      try {
        console.log('🔍 [QR_HTML] Converting hotel coordinates to address:', qrUser.hotelCoordinates);
        hotelAddress = await reverseGeocodingService.getAddressFromCoordinates(
          qrUser.hotelCoordinates.latitude, 
          qrUser.hotelCoordinates.longitude
        );
        console.log('✅ [QR_HTML] Converted hotel coordinates to address:', hotelAddress);
      } catch (error) {
        console.error('❌ [QR_HTML] Error converting hotel coordinates to address:', error);
        // Keep original address if conversion fails
      }
    }

    if (qrUser.busCoordinates && qrUser.busCoordinates.latitude !== 0 && qrUser.busCoordinates.longitude !== 0) {
      try {
        console.log('🔍 [QR_HTML] Converting bus coordinates to address:', qrUser.busCoordinates);
        busAddress = await reverseGeocodingService.getAddressFromCoordinates(
          qrUser.busCoordinates.latitude, 
          qrUser.busCoordinates.longitude
        );
        console.log('✅ [QR_HTML] Converted bus coordinates to address:', busAddress);
      } catch (error) {
        console.error('❌ [QR_HTML] Error converting bus coordinates to address:', error);
        // Keep original address if conversion fails
      }
    }

    console.log('🔍 [QR_HTML] Final addresses for display:', {
      hotelAddress,
      busAddress
    });

    // Debug: Log what data we have for HTML generation
    console.log('🔍 [QR_HTML] Data for HTML generation:', {
      name: qrUser.name,
      roomNo: qrUser.roomNo,
      phone: qrUser.phone,
      hotelName: qrUser.hotelName,
      hotelAddress: hotelAddress,
      busName: qrUser.busName,
      busAddress: busAddress
    });

    // Generate Google Maps navigation URLs
    const hotelMapsUrl = qrUser.hotelCoordinates && qrUser.hotelCoordinates.latitude !== 0 && qrUser.hotelCoordinates.longitude !== 0
      ? `https://www.google.com/maps/dir/?api=1&destination=${qrUser.hotelCoordinates.latitude},${qrUser.hotelCoordinates.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hotelAddress)}`;

    const busMapsUrl = qrUser.busCoordinates && qrUser.busCoordinates.latitude !== 0 && qrUser.busCoordinates.longitude !== 0
      ? `https://www.google.com/maps/dir/?api=1&destination=${qrUser.busCoordinates.latitude},${qrUser.busCoordinates.longitude}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(busAddress)}`;

    // Generate HTML page for Lost Kids/Elderly Person feature
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${qrUser.name} - Emergency Contact Card</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: Arial, sans-serif;
            background: #1a1a1a;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          
          .container {
            background: #2d2d2d;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            padding: 30px;
            max-width: 400px;
            width: 100%;
            text-align: center;
            border: 2px solid #8B4513;
          }
          
          .header {
            background: #8B4513;
            color: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
          }
          
          .name {
            font-size: 2em;
            font-weight: bold;
            margin-bottom: 10px;
          }
          
          .room {
            font-size: 1.1em;
            margin-bottom: 10px;
          }
          
          .emergency-text {
            font-size: 0.9em;
            opacity: 0.9;
          }
          
          .contact-info {
            background: #3d3d3d;
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 20px;
          }
          
          .info-item {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
            padding: 12px;
            background: #2d2d2d;
            border-radius: 8px;
            border-left: 3px solid #8B4513;
          }
          
          .info-item:last-child {
            margin-bottom: 0;
          }
          
          .icon {
            font-size: 1.5em;
            margin-right: 12px;
            width: 25px;
            text-align: center;
          }
          
          .hotel-icon { color: #ff6b6b; }
          .bus-icon { color: #ffa502; }
          .phone-icon { color: #2ed573; }
          .room-icon { color: #8B4513; }
          
          .info-content {
            flex: 1;
            text-align: left;
          }
          
          .info-label {
            font-weight: bold;
            color: #ffffff;
            margin-bottom: 3px;
            font-size: 0.9em;
          }
          
          .info-value {
            color: #cccccc;
            font-size: 0.85em;
          }
          
          .maps-link {
            display: inline-block;
            background: #8B4513;
            color: white;
            text-decoration: none;
            padding: 6px 12px;
            border-radius: 15px;
            font-size: 0.8em;
            margin-top: 5px;
          }
          
          .maps-link:hover {
            background: #A0522D;
          }
          
          .footer {
            margin-top: 15px;
            color: #888;
            font-size: 0.8em;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="name">${qrUser.name}</div>
            <div class="room">Room ${qrUser.roomNo || 'Not specified'}</div>
            <div class="emergency-text">If found, please contact immediately</div>
          </div>
          
          <div class="contact-info">
            <div class="info-item">
              <div class="icon room-icon">🏠</div>
              <div class="info-content">
                <div class="info-label">Room Number</div>
                <div class="info-value">${qrUser.roomNo || 'Not specified'}</div>
              </div>
            </div>
            
            <div class="info-item">
              <div class="icon hotel-icon">🏨</div>
              <div class="info-content">
                <div class="info-label">Hotel Location</div>
                <div class="info-value">${qrUser.hotelName || hotelAddress}</div>
                <div class="info-value" style="font-size: 0.8em; color: #999; margin-top: 3px;">${hotelAddress}</div>
                <a href="${hotelMapsUrl}" target="_blank" class="maps-link">📍 Maps</a>
              </div>
            </div>
            
            <div class="info-item">
              <div class="icon bus-icon">🚌</div>
              <div class="info-content">
                <div class="info-label">Bus Station</div>
                <div class="info-value">${qrUser.busName || busAddress}</div>
                <div class="info-value" style="font-size: 0.8em; color: #999; margin-top: 3px;">${busAddress}</div>
                <a href="${busMapsUrl}" target="_blank" class="maps-link">📍 Maps</a>
              </div>
            </div>
            
            ${qrUser.phone ? `
            <div class="info-item">
              <div class="icon phone-icon">📞</div>
              <div class="info-content">
                <div class="info-label">Emergency Contact</div>
                <div class="info-value">${qrUser.phone}</div>
              </div>
            </div>
            ` : ''}
          </div>
          
          <div class="footer">
            Generated by Mushaba Emergency System
          </div>
        </div>
      </body>
      </html>
    `;

    console.log('🔍 [QR_HTML] Generated HTML with data:', {
      name: qrUser.name,
      roomNo: qrUser.roomNo,
      phone: qrUser.phone,
      hotelName: qrUser.hotelName,
      hotelAddress: hotelAddress,
      busName: qrUser.busName,
      busAddress: busAddress
    });

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    console.log('✅ [QR_HTML] HTML response sent successfully');

  } catch (error) {
    console.error('Error generating QR HTML:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .error { color: #e74c3c; }
        </style>
      </head>
      <body>
        <h1 class="error">Error Loading QR Data</h1>
        <p>There was an error loading the QR user data.</p>
      </body>
      </html>
    `);
  }
};

module.exports = {
  getQRUsers,
  getCurrentUserData,
  createQRUser,
  updateQRUser,
  deleteQRUser,
  updateCurrentUserQR,
  getQRUserHTML
};
