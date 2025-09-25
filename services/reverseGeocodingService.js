const axios = require('axios');

/**
 * Reverse geocoding service using OpenStreetMap Nominatim API
 * Converts latitude and longitude to readable address
 */
class ReverseGeocodingService {
  constructor() {
    this.baseUrl = 'https://nominatim.openstreetmap.org/reverse';
    this.userAgent = 'MushabaApp/1.0'; // Required by Nominatim
  }

  /**
   * Convert coordinates to address
   * @param {number} latitude - Latitude coordinate
   * @param {number} longitude - Longitude coordinate
   * @returns {Promise<string>} - Formatted address string
   */
  async getAddressFromCoordinates(latitude, longitude) {
    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          lat: latitude,
          lon: longitude,
          format: 'json',
          addressdetails: 1,
          zoom: 18
        },
        headers: {
          'User-Agent': this.userAgent
        },
        timeout: 5000
      });

      if (response.data && response.data.display_name) {
        return this.formatAddress(response.data);
      } else {
        return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      }
    } catch (error) {
      console.error('Reverse geocoding error:', error.message);
      // Fallback to coordinates if geocoding fails
      return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    }
  }

  /**
   * Format the address from Nominatim response
   * @param {Object} data - Nominatim response data
   * @returns {string} - Formatted address
   */
  formatAddress(data) {
    const address = data.address || {};
    
    // Build address components in order of specificity
    const components = [];
    
    if (address.house_number && address.road) {
      components.push(`${address.house_number} ${address.road}`);
    } else if (address.road) {
      components.push(address.road);
    }
    
    if (address.suburb) {
      components.push(address.suburb);
    } else if (address.neighbourhood) {
      components.push(address.neighbourhood);
    }
    
    if (address.city) {
      components.push(address.city);
    } else if (address.town) {
      components.push(address.town);
    } else if (address.village) {
      components.push(address.village);
    }
    
    if (address.state) {
      components.push(address.state);
    }
    
    if (address.country) {
      components.push(address.country);
    }
    
    return components.join(', ') || data.display_name;
  }

  /**
   * Batch geocoding for multiple coordinates
   * @param {Array} coordinates - Array of {latitude, longitude} objects
   * @returns {Promise<Array>} - Array of addresses
   */
  async getAddressesFromCoordinates(coordinates) {
    const promises = coordinates.map(coord => 
      this.getAddressFromCoordinates(coord.latitude, coord.longitude)
    );
    
    return Promise.all(promises);
  }
}

module.exports = new ReverseGeocodingService();






