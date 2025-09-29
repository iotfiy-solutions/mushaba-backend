const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { OAuth2Client } = require('google-auth-library');

// Google Sign-In
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// POST /api/auth/google
// Body: { idToken }
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) {
      return res.status(400).json({ success: false, message: 'Missing idToken' });
    }

    // Verify Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    const googleSub = payload.sub; // stable Google user id
    const email = payload.email;
    const name = payload.name || (payload.given_name ? `${payload.given_name} ${payload.family_name || ''}`.trim() : 'User');
    const picture = payload.picture || null;

    if (!googleSub) {
      return res.status(401).json({ success: false, message: 'Invalid Google token' });
    }

    // Find or create local user by email (preferred) or Google sub
    let user = null;
    if (email) {
      user = await User.findOne({ email });
    }
    if (!user) {
      // Fallback by username = googleSub if no email match
      user = await User.findOne({ username: googleSub });
    }

    if (!user) {
      // Create a new user; store google info in username/email
      user = new User({
        name: name,
        email: email || undefined,
        phone: null,
        nationality: 'unknown',
        username: email || googleSub,
        image: picture || null,
        password: Math.random().toString(36).slice(2) // placeholder; not used for Google auth
      });
      await user.save();
    }

    // Issue your app JWT
    const token = user.getSignedJwtToken();

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        image: user.image,
        qrCode: user.qrCode
      }
    });
  } catch (error) {
    console.error('Google sign-in error:', error);
    return res.status(401).json({ success: false, message: 'Google sign-in failed' });
  }
});

// Register user
router.post('/register', async (req, res) => {
  try {
    console.log('Registration request body:', req.body);
    const { name, email, phone, nationality, username, password, image } = req.body;

    // Validate required fields
    if (!name || !email || !nationality || !username || !password) {
      console.log('Missing required fields:', { name, email, nationality, username, password });
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    // Validate email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email' });
    }

    // Check if user already exists
    let user = await User.findOne({ username });
    if (user) {
      console.log('Username already exists:', username);
      return res.status(400).json({
        success: false,
        message: 'Username already exists'
      });
    }

    // Check if email already exists
    const emailExists = await User.findOne({ email });
    if (emailExists) {
      console.log('Email already exists:', email);
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    // Create new user
    user = new User({
      name,
      email,
      phone: phone || null,
      nationality,
      username,
      password,
      image: image || null // Add image field
    });

    console.log('Attempting to save new user:', { name, username });

    // Save user (password will be hashed by the pre-save hook)
    await user.save();
    console.log('User saved successfully:', user._id);

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

    // Create token
    const token = user.getSignedJwtToken();
    console.log('Token generated successfully');

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        username: user.username,
        image: user.image,
        qrCode: user.qrCode
      }
    });
  } catch (error) {
    console.error('Registration error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    res.status(500).json({
      success: false,
      message: 'Error registering user'
    });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    console.log('Login request body:', req.body);
    const { username, password } = req.body;

    // Validate required fields
    if (!username || !password) {
      console.log('Missing required fields:', { username, password });
      return res.status(400).json({
        success: false,
        message: 'Please provide username and password'
      });
    }

    // Check if user exists and explicitly select password field
    const user = await User.findOne({ username }).select('+password');
    console.log('User found:', user ? 'Yes' : 'No');

    if (!user) {
      console.log('No user found with username:', username);
      return res.status(400).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Check password
    console.log('Comparing passwords...');
    const isMatch = await user.comparePassword(password);
    console.log('Password match:', isMatch);

    if (!isMatch) {
      console.log('Password does not match');
      return res.status(400).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Create token
    console.log('Generating token...');
    const token = user.getSignedJwtToken();
    console.log('Token generated successfully');

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        image: user.image,
        qrCode: user.qrCode
      }
    });
  } catch (error) {
    console.error('Login error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    res.status(500).json({
      success: false,
      message: 'Error logging in'
    });
  }
});

// Get current user
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user'
    });
  }
});

// Update password
router.put('/password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get user
    const user = await User.findById(req.user.id).select('+password');

    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // Save user
    await user.save();

    res.json({
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating password'
    });
  }
});

// Forgot Password - Request reset code
router.post('/forgot-password/request', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Avoid leaking which emails exist
      return res.json({ success: true, message: 'If the email exists, a code has been sent' });
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    user.resetCode = resetCode;
    user.resetCodeExpires = expires;
    await user.save();

    // Send email
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      await transporter.sendMail({
        from: process.env.MAIL_FROM || 'no-reply@example.com',
        to: email,
        subject: 'Your password reset code',
        text: `Your password reset code is ${resetCode}. It expires in 15 minutes.`,
        html: `<p>Your password reset code is <b>${resetCode}</b>. It expires in 15 minutes.</p>`
      });

      // Only success if email actually sent
      return res.json({ success: true, message: 'If the email exists, a code has been sent' });
    } catch (mailErr) {
      console.error('Failed to send reset email:', mailErr);
      // Clear the code so user can retry cleanly
      try {
        user.resetCode = null;
        user.resetCodeExpires = null;
        await user.save();
      } catch (clearErr) {
        console.error('Failed to clear reset code after mail error:', clearErr);
      }
      return res.status(500).json({ success: false, message: 'Failed to send reset email' });
    }
  } catch (error) {
    console.error('Error requesting reset code:', error);
    res.status(500).json({ success: false, message: 'Error requesting reset code' });
  }
});

// Forgot Password - Verify code
router.post('/forgot-password/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'Email and code are required' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.resetCode || !user.resetCodeExpires) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }

    if (user.resetCode !== code || user.resetCodeExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }

    return res.json({ success: true, message: 'Code is valid' });
  } catch (error) {
    console.error('Error verifying reset code:', error);
    res.status(500).json({ success: false, message: 'Error verifying code' });
  }
});

// Forgot Password - Reset password
router.post('/forgot-password/reset', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email, code, and new password are required' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.resetCode || !user.resetCodeExpires) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }

    if (user.resetCode !== code || user.resetCodeExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }

    // Set new password; pre-save hook will hash it
    user.password = newPassword;
    user.resetCode = null;
    user.resetCodeExpires = null;
    await user.save();

    return res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ success: false, message: 'Error resetting password' });
  }
});

module.exports = router; 
