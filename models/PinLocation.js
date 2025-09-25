const mongoose = require('mongoose');

const pinLocationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  connectionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Connection',
    required: true,
    index: true
  },
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['taxi', 'bus', 'restaurant', 'hotel', 'cafe', 'coffee', 'shopping', 'parking', 'hospital', 'school', 'office', 'gas', 'location', 'other'],
    index: true
  },
  name: {
    type: String,
    required: true,
    maxlength: 100
  },
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
  comment: {
    type: String,
    required: false,
    maxlength: 500,
    default: ''
  },
  images: [{
    type: String,
    required: false
  }],
  icon: {
    type: String,
    required: true
  },
  markedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient querying
pinLocationSchema.index({ connectionId: 1, isActive: 1 });
pinLocationSchema.index({ userId: 1, isActive: 1 });
pinLocationSchema.index({ chatId: 1, isActive: 1 });
pinLocationSchema.index({ type: 1, isActive: 1 });

// TTL index for automatic deletion after 48 hours
pinLocationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save middleware to set expiration time (48 hours from creation)
pinLocationSchema.pre('save', function(next) {
  if (this.isNew) {
    this.expiresAt = new Date(Date.now() + (48 * 60 * 60 * 1000)); // 48 hours
  }
  this.updatedAt = new Date();
  next();
});

// Instance method to check if pin is expired
pinLocationSchema.methods.isExpired = function() {
  return new Date() > this.expiresAt;
};

// Instance method to extend expiration (reset to 48 hours)
pinLocationSchema.methods.extendExpiration = function() {
  this.expiresAt = new Date(Date.now() + (48 * 60 * 60 * 1000));
  this.updatedAt = new Date();
  return this.save();
};

// Static method to get active pins for a connection
pinLocationSchema.statics.getActivePinsForConnection = function(connectionId) {
  return this.find({
    connectionId,
    isActive: true,
    expiresAt: { $gt: new Date() }
  }).populate('userId', 'name username profilePicture');
};

// Static method to get user's active pins
pinLocationSchema.statics.getUserActivePins = function(userId) {
  return this.find({
    userId,
    isActive: true,
    expiresAt: { $gt: new Date() }
  }).populate('connectionId', 'name');
};

// Static method to cleanup expired pins
pinLocationSchema.statics.cleanupExpiredPins = async function() {
  const expiredPins = await this.find({
    expiresAt: { $lte: new Date() },
    isActive: true
  });
  
  if (expiredPins.length > 0) {
    await this.updateMany(
      { _id: { $in: expiredPins.map(pin => pin._id) } },
      { isActive: false }
    );
    console.log(`[PIN_CLEANUP] Deactivated ${expiredPins.length} expired pins`);
  }
  
  return expiredPins.length;
};

const PinLocation = mongoose.model('PinLocation', pinLocationSchema);

module.exports = PinLocation;
