/**
 * HD Wallet Module - Generate TRC-20 addresses using BIP-44 derivation
 * Path: m/44'/195'/0'/0/x (TRON coin type = 195)
 */
const bip39 = require('bip39');
const HDKey = require('hdkey');
const TronWeb = require('tronweb');
const config = require('./config');
const logger = require('./logger');

class WalletManager {
  constructor(redisClient) {
    this.redis = redisClient;
    this.tronWeb = new TronWeb({
      fullHost: config.tron.fullNode,
      headers: config.tron.apiKey ? { 'TRON-PRO-API-KEY': config.tron.apiKey } : {},
    });
  }

  /**
   * Generate a new deposit address for a user
   * @param {string} userId - Unique user identifier
   * @returns {object} { address, addressIndex }
   */
  async generateAddress(userId) {
    // Get next address index
    const addressIndex = await this.redis.incr('tron:address:index');

    // Derive address from HD wallet
    const seed = await bip39.mnemonicToSeed(config.wallet.mnemonic);
    const hdKey = HDKey.fromMasterSeed(seed);
    const derivedKey = hdKey.derive(`${config.wallet.hdPath}/${addressIndex}`);
    const privateKey = derivedKey.privateKey.toString('hex');

    // Convert to TRON address
    const address = this.tronWeb.address.fromPrivateKey(privateKey);

    // Store mapping: userId -> address, address -> privateKey
    // WARNING: In production, encrypt privateKey before storing!
    // Use AES-256-GCM with a KMS-managed key for encryption
    await this.redis.hset('tron:user:addresses', userId, address);
    await this.redis.hset('tron:address:keys', address, privateKey);
    await this.redis.hset('tron:address:index_map', address, addressIndex.toString());
    await this.redis.sadd('tron:monitored:addresses', address);

    logger.info(`Generated address for user ${userId}: ${address} (index: ${addressIndex})`);

    return { address, addressIndex };
  }

  /**
   * Get user's deposit address
   * @param {string} userId
   * @returns {string|null} TRON address
   */
  async getUserAddress(userId) {
    return await this.redis.hget('tron:user:addresses', userId);
  }

  /**
   * Get private key for an address (for signing consolidation transactions)
   * @param {string} address
   * @returns {string|null} private key
   */
  async getPrivateKey(address) {
    return await this.redis.hget('tron:address:keys', address);
  }

  /**
   * Get all monitored addresses
   * @returns {string[]} array of addresses
   */
  async getMonitoredAddresses() {
    return await this.redis.smembers('tron:monitored:addresses');
  }
}

module.exports = WalletManager;
