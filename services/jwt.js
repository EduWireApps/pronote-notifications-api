const jwt = require('jsonwebtoken')
const config = require('../config.json')

class JWTService {
    static createToken (payload) {
        return jwt.sign(payload, config.jwtKey)
    }

    static verifyToken (token = '') {
        try {
            return jwt.verify(token, config.jwtKey)
        } catch {
            return null
        }
    }
}

module.exports = JWTService
