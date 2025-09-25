const mongoose = require('mongoose');

const connectionLocationSchema = new mongoose.Schema({
  connectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Connection',
    required: true,
    unique: true
  },
  users: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    currentLocation: {
      latitude: {
        type: Number,
        required: true,
        min: -90,
        max: 90
      },
      longitude: {
        type: Number,
        required: true,
        min: -180,
        max: 180
      },
      floor: {
        type: String,
        enum: ['B', 'G', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'],
        default: null
      },
      lastUpdated: {
        type: Date,
        default: Date.now
      },
      online: {
        type: Boolean,
        default: true
      }
    },
    locationHistory: [{
      latitude: Number,
      longitude: Number,
      floor: String,
      timestamp: {
        type: Date,
        default: Date.now
      },
      accuracy: Number,
      speed: Number,
      heading: Number
    }],
    stats: {
      totalLocations: { type: Number, default: 0 },
      lastActive: { type: Date, default: Date.now },
      averageSpeed: { type: Number, default: 0 },
      totalDistance: { type: Number, default: 0 }
    }
  }],
  connectionStats: {
    lastActivity: { type: Date, default: Date.now },
    activeUsers: { type: Number, default: 0 },
    totalLocations: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

// Indexes for optimal performance (removed duplicate connectionId index)
connectionLocationSchema.index({ 'users.userId': 1 });
connectionLocationSchema.index({ 'connectionStats.lastActivity': -1 });
connectionLocationSchema.index({ 'users.currentLocation.online': 1 });

// Compound index for efficient queries
connectionLocationSchema.index({ 
  connectionId: 1, 
  'users.currentLocation.online': 1 
});

const ConnectionLocation = mongoose.model('ConnectionLocation', connectionLocationSchema);

module.exports = { ConnectionLocation };
