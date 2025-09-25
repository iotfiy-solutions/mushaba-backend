const User = require("../models/User");
const bcrypt = require("bcryptjs");
const QRCode = require('qrcode');
const Connection = require('../models/Connection');
const Notification = require('../models/Notification');
const { createNotification } = require('./notificationController');

// Get user by ID
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
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
        name: user.name,
        username: user.username,
        image: user.image,
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

// Update user
exports.updateUser = async (req, res) => {
  try {
    const { name, username, oldPassword, newPassword } = req.body;
    const userId = req.params.id;

    // Find user
    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    // If updating password
    if (oldPassword && newPassword) {
      // Verify old password
      const isMatch = await bcrypt.compare(oldPassword, user.password);
      if (!isMatch) {
        return res.status(401).json({ 
          success: false,
          message: 'Current password is incorrect' 
        });
      }

      // Hash new password
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
    }

    // Update other fields
    if (name) {
      if (!name.trim()) {
        return res.status(400).json({ 
          success: false,
          message: 'Name cannot be empty' 
        });
      }
      user.name = name.trim();
    }

    if (username) {
      if (!username.trim()) {
        return res.status(400).json({ 
          success: false,
          message: 'Username cannot be empty' 
        });
      }

      // Check if username is already taken by another user
      const existingUser = await User.findOne({ 
        username: username.trim(),
        _id: { $ne: userId }
      });
      
      if (existingUser) {
        return res.status(400).json({ 
          success: false,
          message: 'Username already taken' 
        });
      }

      user.username = username.trim();
    }

    // If username is being updated, generate new QR code
    if (username) {
      const qrCodeDataUrl = await QRCode.toDataURL(user._id.toString());
      user.qrCode = qrCodeDataUrl;
    }

    await user.save();

    // Return updated user without password
    const updatedUser = await User.findById(userId).select('-password');
    res.json({ 
      success: true,
      user: updatedUser 
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error updating user',
      error: error.message 
    });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, username, oldPassword, newPassword } = req.body;
    const userId = req.params.userId;

    // Find user by ID
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Update name if provided and different
    if (name !== undefined && name !== user.name) {
      if (!name.trim()) {
        return res.status(400).json({ success: false, message: 'Name cannot be empty' });
      }
      user.name = name.trim();
    }

    // Update username if provided and different
    if (username !== undefined && username !== user.username) {
      if (!username.trim()) {
        return res.status(400).json({ success: false, message: 'Username cannot be empty' });
      }
      // Check if new username is already taken by another user
      const existingUser = await User.findOne({ username: username.trim() });
      if (existingUser && existingUser._id.toString() !== userId) {
        return res.status(400).json({ success: false, message: 'Username already taken' });
      }
      user.username = username.trim();
    }

    // If password is being updated
    if (oldPassword && newPassword) {
      // Verify old password
      const isMatch = await bcrypt.compare(oldPassword, user.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
      }

      // Hash new password
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
    }

    // Save updated user
    await user.save();

    // Return updated user info (excluding password)
    res.json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ success: false, message: 'Error updating profile' });
  }
};

// Delete user account
exports.deleteUser = async (req, res) => {
  try {
    console.log('DELETE USER REQUEST BODY:', req.body);
    const userId = req.user.id;
    const { password } = req.body;
    const user = await User.findById(userId).select('+password');
    if (!user) {
      console.error('User not found for deletion:', userId);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      console.error('Password incorrect for user:', userId);
      return res.status(401).json({ success: false, message: 'Password is incorrect' });
    }
    // Check if user is owner of any connection
    const ownerConnections = await Connection.find({ 'users.userId': userId, 'users.role': 'owner' });
    if (ownerConnections.length > 0) {
      console.error('User is owner of connections:', ownerConnections.map(c => c._id));
      return res.status(400).json({ success: false, message: 'You are the owner of one or more connections. Please transfer ownership before deleting your account.' });
    }
    // Remove user from all connections
    const connections = await Connection.find({ 'users.userId': userId });
    for (const connection of connections) {
      connection.users = connection.users.filter(u => u.userId.toString() !== userId);
      if (connection.users.length === 0) {
        await connection.deleteOne();
      } else {
        await connection.save();
        for (const member of connection.users) {
          await createNotification(
            member.userId,
            'user_removed',
            `${user.name} deleted their account and was removed from the connection`,
            { connectionId: connection._id, removedUserId: userId, type: 'warning' }
          );
        }
      }
    }
    await user.deleteOne();
    console.log('User deleted successfully:', userId);
    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, message: 'Error deleting account', error: error.message });
  }
};

// Check and fix user status for socket connection
exports.checkUserStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // If user doesn't have status field, add it
    if (!user.status) {
      user.status = 'active';
      user.lastSeen = new Date();
      await user.save();
      console.log(`[USER_STATUS] Added status field to user ${userId}`);
    }

    res.json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        name: user.name,
        status: user.status,
        lastSeen: user.lastSeen
      }
    });
  } catch (error) {
    console.error('Error checking user status:', error);
    res.status(500).json({ success: false, message: 'Error checking user status' });
  }
}; 