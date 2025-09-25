const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const QRCode = require('qrcode');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
    trim: true,
    maxlength: [50, "Name cannot be more than 50 characters"]
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, "Please add a valid email"]
  },
  phone: {
    type: String,
    trim: true,
    default: null
  },
  username: {
    type: String,
    required: [true, "Username is required"],
    unique: true,
    trim: true,
    minlength: [3, "Username must be at least 3 characters long"]
  },
  password: {
    type: String,
    required: [true, "Password is required"],
    minlength: [6, "Password must be at least 6 characters long"],
    select: false
  },
  nationality: {
    type: String,
    required: [true, "Nationality is required"],
    trim: true
  },
  image: {
    type: String,
    default: null
  },
  qrCode: {
    type: String,
    unique: true
  },
  resetCode: {
    type: String,
    default: null
  },
  resetCodeExpires: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'online', 'offline'],
    default: 'active'
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  // NEW: Cached active locations for quick UI access
  activeLocations: {
    busStation: {
      name: {
        type: String,
        default: "Unmarked"
      },
      latitude: {
        type: Number,
        default: null
      },
      longitude: {
        type: Number,
        default: null
      },
      source: {
        type: String,
        enum: ['personal', 'group', 'unmarked'],
        default: 'unmarked'
      },
      locationId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
      },
      connectionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Connection',
        default: null
      },
      isMarked: {
        type: Boolean,
        default: false
      },
      lastUpdated: {
        type: Date,
        default: Date.now
      }
    },
    hotel: {
      name: {
        type: String,
        default: "Unmarked"
      },
      roomNumber: {
        type: String,
        default: null
      },
      latitude: {
        type: Number,
        default: null
      },
      longitude: {
        type: Number,
        default: null
      },
      source: {
        type: String,
        enum: ['personal', 'group', 'unmarked'],
        default: 'unmarked'
      },
      locationId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
      },
      connectionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Connection',
        default: null
      },
      isMarked: {
        type: Boolean,
        default: false
      },
      lastUpdated: {
        type: Date,
        default: Date.now
      }
    }
  },
  // NEW: Personal marked locations array
  markedLocations: [{
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      default: mongoose.Types.ObjectId
    },
    type: {
      type: String,
      enum: ['bus_station', 'hotel'],
      required: true
    },
    name: {
      type: String,
      required: true
    },
    latitude: {
      type: Number,
      required: true
    },
    longitude: {
      type: Number,
      required: true
    },
    source: {
      type: String,
      enum: ['personal', 'group'],
      default: 'personal'
    },
    connectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Connection',
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Create indexes
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ qrCode: 1 }, { unique: true });

// Generate QR Code
userSchema.pre('save', async function(next) {
  if (!this.qrCode) {
    try {
      // Generate QR code as base64 string
      const qrCodeData = await QRCode.toDataURL(this._id.toString(), {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 200,
        color: {
          dark: '#FFFFFF',      // White pattern
          light: '#00000000'    // Transparent background
        }
      });
      this.qrCode = qrCodeData;
    } catch (error) {
      console.error('Error generating QR code:', error);
      next(error);
    }
  }
  next();
});

// Encrypt password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Sign JWT
userSchema.methods.getSignedJwtToken = function() {
  return jwt.sign(
    { id: this._id },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '30d' }  // 30 days
  );
};

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

// Remove sensitive data when converting to JSON
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  return user;
};

const User = mongoose.model("User", userSchema);

module.exports = User; 