const User = require("../models/User");
const bcrypt = require("bcryptjs");
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');

exports.register = async (req, res) => {
  try {
    const { username, name, password } = req.body;

    // Validate required fields
    if (!username || !name || !password) {
      return res.status(400).json({ 
        success: false,
        message: 'Please provide all required fields' 
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        message: 'Username already exists' 
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const user = new User({
      username,
      name,
      password: hashedPassword
    });

    await user.save();

    // Generate QR code with user's MongoDB ID
    const qrCodeDataUrl = await QRCode.toDataURL(user._id.toString());
    
    // Update user with QR code
    user.qrCode = user._id.toString(); // Store just the ID
    await user.save();

    // Create personal chat for the new user
    try {
      const Chat = require('../models/Chat');
      const personalChat = new Chat({
        type: 'personal',
        participants: [{
          userId: user._id,
          status: 'active',
          joinTimestamp: new Date()
        }],
        metadata: {
          name: 'Personal Chat',
          description: 'Your personal chat for notes and media',
          isPersonal: true
        }
      });
      
      await personalChat.save();
      console.warn('? [PERSONAL_CHAT] Personal chat created for user:', user._id, 'Chat ID:', personalChat._id);
    } catch (chatError) {
      console.warn('? [PERSONAL_CHAT] Error creating personal chat:', chatError.message);
      console.warn('? [PERSONAL_CHAT] Full error:', chatError);
      // Don't fail registration if chat creation fails
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Return user data and token
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        _id: user._id,
        username: user.username,
        name: user.name,
        qrCode: qrCodeDataUrl // Send the image URL to client
      },
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error registering user' 
    });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate required fields
    if (!username || !password) {
      return res.status(400).json({ 
        success: false,
        message: 'Please provide username and password' 
      });
    }

    // Find user by username and explicitly select password field
    const user = await User.findOne({ username }).select('+password');
    
    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid credentials' 
      });
    }

    // Check if password exists
    if (!user.password) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid credentials' 
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid credentials' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Return user info and token
    res.json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        name: user.name,
        qrCode: user.qrCode
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error logging in' 
    });
  }
};

exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Generate QR code data URL
    const qrCodeDataUrl = await QRCode.toDataURL(user._id.toString());

    res.json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        name: user.name,
        qrCode: qrCodeDataUrl
      }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user data'
    });
  }
}; 