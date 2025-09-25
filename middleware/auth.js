const jwt = require('jsonwebtoken');

const protect = (req, res, next) => {
  try {
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token, authorization denied'
      });
    }

    console.log('Auth middleware - Token:', token);

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Auth middleware - Decoded token:', decoded);
    
    // Add user from payload
    req.user = {
      id: decoded.id, // This is the MongoDB ID from the token
      ...decoded
    };

    console.log('Auth middleware - Set user:', req.user);
    next();
  } catch (error) {
    console.error('Auth middleware - Error:', error);
    res.status(401).json({
      success: false,
      message: 'Token is not valid',
      error: error.message
    });
  }
};

module.exports = { protect }; 