/**
 * TRON USDT Payment Service - Main Entry Point
 * 
 * Features:
 * - HD wallet address generation for users
 * - TRC-20 USDT deposit monitoring
 * - Auto-consolidation with energy optimization (< 3 TRX per tx)
 * 
 * Fee optimization strategy:
 * 1. Delegate energy from hot wallet (Stake 2.0) - FREE
 * 2. Rent energy from marketplace - ~1-2 TRX
 * 3. Use free bandwidth (1500/day per account)
 * Total cost: 1-3 TRX per consolidation
 */
const Redis = require('ioredis');
const config = require('./config');
const logger = require('./logger');
const WalletManager = require('./wallet');
const EnergyManager = require('./energy');
const ConsolidationService = require('./consolidation');
const DepositMonitor = require('./monitor');

class TronPaymentService {
  constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    this.walletManager = new WalletManager(this.redis);
    this.energyManager = new EnergyManager();
    this.consolidationService = new ConsolidationService(
      this.redis,
      this.walletManager,
      this.energyManager
    );
    this.depositMonitor = new DepositMonitor(
      this.redis,
      this.walletManager,
      this.consolidationService
    );
  }

  /**
   * Start the payment service
   */
  async start() {
    logger.info('=== TRON USDT Payment Service Starting ===');
    logger.info(`Consolidation address: ${config.wallet.consolidationAddress}`);
    logger.info(`USDT contract: ${config.usdt.contractAddress}`);
    logger.info(`Poll interval: ${config.service.pollIntervalMs}ms`);
    logger.info(`Min consolidation amount: ${config.usdt.minAmountToConsolidate / 1e6} USDT`);

    // Verify Redis connection
    await this.redis.ping();
    logger.info('Redis connected');

    // Start deposit monitoring
    await this.depositMonitor.start();
  }

  /**
   * Stop the payment service gracefully
   */
  async stop() {
    logger.info('Shutting down...');
    this.depositMonitor.stop();
    await this.redis.quit();
    logger.info('Service stopped');
  }

  /**
   * API: Generate a new deposit address for a user
   * @param {string} userId
   * @returns {object} { address, addressIndex }
   */
  async createDepositAddress(userId) {
    return await this.walletManager.generateAddress(userId);
  }

  /**
   * API: Get user's deposit address
   * @param {string} userId
   * @returns {string|null}
   */
  async getDepositAddress(userId) {
    return await this.walletManager.getUserAddress(userId);
  }

  /**
   * API: Get deposit balance for an address
   * @param {string} address
   * @returns {number} balance in USDT sun units
   */
  async getBalance(address) {
    const balance = await this.redis.hget('tron:address:balance', address);
    return parseInt(balance || '0', 10);
  }

  /**
   * API: Manually trigger consolidation for an address
   * @param {string} address
   */
  async triggerConsolidation(address) {
    const balance = await this.getBalance(address);
    if (balance > 0) {
      await this.consolidationService.queueConsolidation(address, balance);
    }
  }
}

// Main execution
const service = new TronPaymentService();

service.start().catch(error => {
  logger.error('Failed to start service:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => service.stop());
process.on('SIGTERM', () => service.stop());

module.exports = TronPaymentService;
