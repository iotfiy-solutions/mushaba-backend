const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const Connection = require('../models/Connection');
const ActivityLog = require('../models/ActivityLog');

// All routes require authentication
router.use(protect);

// Health check
router.get('/health', (req, res) => {
  const hasKey = !!process.env.GOOGLE_API_KEY;
  return res.json({ success: true, geminiConfigured: hasKey });
});

// Chat endpoint using Gemini Flash with MongoDB context
router.post('/chat', async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, message: 'GOOGLE_API_KEY is not configured' });
    }

    const { userText } = req.body || {};
    if (!userText || typeof userText !== 'string') {
      return res.status(400).json({ success: false, message: 'userText is required' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const userId = req.user.id;

    // Build lightweight domain context from MongoDB
    const [user, activeConnection] = await Promise.all([
      User.findById(userId).select('name username email image qrCode').lean(),
      Connection.getUserActiveConnection(userId)
    ]);

    let activity = [];
    try {
      if (activeConnection && activeConnection._id) {
        activity = await ActivityLog.find({ connectionId: activeConnection._id })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean();
      }
    } catch (_) {}

    // Prepare minimal context object (avoid sending sensitive fields)
    const context = {
      currentUser: user ? { id: userId, name: user.name, username: user.username } : null,
      activeConnection: activeConnection
        ? {
            id: activeConnection._id,
            status: activeConnection.metadata?.status,
            users: (activeConnection.users || []).map(u => ({
              userId: u.userId?.toString ? u.userId.toString() : u.userId,
              role: u.role,
              status: u.status
            })),
            markedLocations: (activeConnection.markedLocations || []).slice(-10).map(m => ({
              type: m.type,
              name: m.name,
              latitude: m.latitude,
              longitude: m.longitude,
              updatedAt: m.updatedAt
            }))
          }
        : null,
      recentActivity: (activity || []).map(a => ({
        type: a.activityType,
        at: a.createdAt,
        actor: a.actor?.name || a.actor?.userId,
        target: a.target?.name || a.target?.userId,
        message: a.message
      }))
    };

    const now = new Date().toISOString();
    const prompt = `Current DateTime: ${now}\n` +
      `Context (JSON): ${JSON.stringify(context)}\n\n` +
      `User Query: ${userText}\n\n` +
      `Guidelines: Answer briefly and clearly. Use only provided context; do not invent data. If the question is unrelated to the context, answer as a general assistant. Avoid code blocks unless asked.`;

    const result = await model.generateContent([prompt]);
    const text = result?.response?.text?.() || '';

    return res.json({ success: true, response: text });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gemini error', error: error.message });
  }
});

module.exports = { router };


