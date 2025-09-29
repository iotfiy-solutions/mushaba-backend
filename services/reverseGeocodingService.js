const axios = require('axios');

/**
 * Enhanced geocoding service using OpenStreetMap Nominatim API
 * Converts latitude and longitude to readable address and vice versa
 */
class ReverseGeocodingService {
  constructor() {
    this.baseUrl = 'https://nominatim.openstreetmap.org/reverse';
    this.searchUrl = 'https://nominatim.openstreetmap.org/search';
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
    
    // PRIORITY 1: Business/Place names (hotels, restaurants, landmarks, etc.)
    if (address.hotel) {
      components.push(address.hotel);
    } else if (address.restaurant) {
      components.push(address.restaurant);
    } else if (address.tourism) {
      components.push(address.tourism);
    } else if (address.amenity) {
      components.push(address.amenity);
    } else if (address.leisure) {
      components.push(address.leisure);
    } else if (address.shop) {
      components.push(address.shop);
    } else if (address.office) {
      components.push(address.office);
    } else if (address.building && this.isBusinessName(address.building)) {
      components.push(address.building);
    }
    
    // PRIORITY 2: Building/Plot/House details
    if (address.house_number) {
      components.push(`House ${address.house_number}`);
    }
    
    if (address.building && !this.isBusinessName(address.building)) {
      components.push(`Building ${address.building}`);
    }
    
    if (address.plot_number) {
      components.push(`Plot ${address.plot_number}`);
    }
    
    if (address.flat) {
      components.push(`Flat ${address.flat}`);
    }
    
    if (address.unit) {
      components.push(`Unit ${address.unit}`);
    }
    
    // PRIORITY 3: Street/Road
    if (address.road) {
      components.push(address.road);
    } else if (address.pedestrian) {
      components.push(address.pedestrian);
    } else if (address.footway) {
      components.push(address.footway);
    }
    
    // PRIORITY 4: Area details
    if (address.suburb) {
      components.push(address.suburb);
    } else if (address.neighbourhood) {
      components.push(address.neighbourhood);
    } else if (address.quarter) {
      components.push(address.quarter);
    }
    
    // PRIORITY 5: City/Town
    if (address.city) {
      components.push(address.city);
    } else if (address.town) {
      components.push(address.town);
    } else if (address.village) {
      components.push(address.village);
    } else if (address.hamlet) {
      components.push(address.hamlet);
    }
    
    // PRIORITY 6: State/Province
    if (address.state) {
      components.push(address.state);
    } else if (address.province) {
      components.push(address.province);
    } else if (address.region) {
      components.push(address.region);
    }
    
    // PRIORITY 7: Postal code
    if (address.postcode) {
      components.push(address.postcode);
    }
    
    // PRIORITY 8: Country
    if (address.country) {
      components.push(address.country);
    }
    
    return components.join(', ') || data.display_name;
  }

  /**
   * Check if a building name looks like a business name rather than a generic building
   * @param {string} building - Building name
   * @returns {boolean} - True if it looks like a business name
   */
  isBusinessName(building) {
    if (!building) return false;
    
    // Common business name indicators
    const businessIndicators = [
      'hotel', 'resort', 'inn', 'lodge', 'palace', 'tower', 'plaza', 'center', 'centre',
      'restaurant', 'cafe', 'bar', 'grill', 'bistro', 'diner', 'eatery',
      'mall', 'shopping', 'market', 'store', 'shop', 'boutique',
      'office', 'building', 'complex', 'tower', 'plaza', 'center'
    ];
    
    const lowerBuilding = building.toLowerCase();
    return businessIndicators.some(indicator => lowerBuilding.includes(indicator));
  }

  /**
   * Convert address to coordinates
   * @param {string} address - Address string
   * @returns {Promise<Object>} - {latitude, longitude} object
   */
  async getCoordinatesFromAddress(address) {
    try {
      const response = await axios.get(this.searchUrl, {
        params: {
          q: address,
          format: 'json',
          limit: 1,
          addressdetails: 1,
          accept_language: 'en'
        },
        headers: {
          'User-Agent': this.userAgent
        },
        timeout: 5000
      });

      if (response.data && response.data.length > 0 && response.data[0].lat && response.data[0].lon) {
        return {
          latitude: parseFloat(response.data[0].lat),
          longitude: parseFloat(response.data[0].lon)
        };
      } else {
        throw new Error('No coordinates found for address');
      }
    } catch (error) {
      console.error('Geocoding error:', error.message);
      // Return default coordinates (0,0) if geocoding fails
      return {
        latitude: 0,
        longitude: 0
      };
    }
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

  /**
   * Batch geocoding for multiple addresses
   * @param {Array} addresses - Array of address strings
   * @returns {Promise<Array>} - Array of {latitude, longitude} objects
   */
  async getCoordinatesFromAddresses(addresses) {
    const promises = addresses.map(address => 
      this.getCoordinatesFromAddress(address)
    );
    
    return Promise.all(promises);
  }
}

module.exports = new ReverseGeocodingService();






