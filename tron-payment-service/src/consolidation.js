/**
 * Consolidation Service - Auto-consolidate USDT from user addresses to hot wallet
 * 
 * Flow:
 * 1. Receive consolidation request
 * 2. Delegate energy to user address (via Stake 2.0 or rental)
 * 3. Send USDT from user address to consolidation address
 * 4. Undelegate energy after completion
 * 
 * Total cost target: < 3 TRX per consolidation
 */
const TronWeb = require('tronweb');
const config = require('./config');
const logger = require('./logger');

class ConsolidationService {
  constructor(redisClient, walletManager, energyManager) {
    this.redis = redisClient;
    this.walletManager = walletManager;
    this.energyManager = energyManager;
    this.tronWeb = new TronWeb({
      fullHost: config.tron.fullNode,
      headers: config.tron.apiKey ? { 'TRON-PRO-API-KEY': config.tron.apiKey } : {},
    });
    this.processing = false;
  }

  /**
   * Queue an address for consolidation
   * @param {string} address - User address with USDT to consolidate
   * @param {number} amount - USDT amount in sun units
   */
  async queueConsolidation(address, amount) {
    await this.redis.rpush('tron:consolidation:queue', JSON.stringify({
      address,
      amount,
      queuedAt: Date.now(),
    }));
    logger.info(`Queued consolidation: ${address} with ${amount / 1e6} USDT`);

    // Process immediately if not already processing
    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * Process the consolidation queue
   */
  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const item = await this.redis.lpop('tron:consolidation:queue');
        if (!item) break;

        const { address, amount } = JSON.parse(item);
        await this.consolidate(address, amount);

        // Small delay between consolidations to avoid rate limits
        await this.sleep(3000);
      }
    } catch (error) {
      logger.error('Error processing consolidation queue:', error.message);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Execute consolidation for a single address
   * @param {string} address - User address
   * @param {number} amount - USDT amount to consolidate
   */
  async consolidate(address, amount) {
    logger.info(`Starting consolidation: ${address} -> ${config.wallet.consolidationAddress} (${amount / 1e6} USDT)`);

    try {
      // Step 1: Check current resources on user address
      const resources = await this.energyManager.getAccountResources(address);
      logger.info(`Address ${address} resources: energy=${resources.energy}, bandwidth=${resources.bandwidth}`);

      // Step 2: Delegate energy if needed
      let energyDelegated = false;
      if (resources.energy < config.energy.requiredEnergy) {
        const energyResult = await this.energyManager.delegateEnergy(address);
        if (!energyResult.success) {
          logger.warn(`Failed to delegate/rent energy for ${address}, proceeding with TRX burn (higher cost)`);
        } else {
          energyDelegated = true;
          // Wait for delegation to take effect
          await this.sleep(5000);
        }
      }

      // Step 3: Check if address needs bandwidth (TRX for bandwidth)
      // If free bandwidth is available (>= 345 bytes for a TRC-20 transfer), skip
      if (resources.bandwidth < 345) {
        // Transfer minimal TRX for bandwidth (0.345 TRX should cover ~345 bandwidth)
        await this.transferTrxForBandwidth(address);
        await this.sleep(3000);
      }

      // Step 4: Execute USDT transfer from user address to consolidation address
      const result = await this.executeUsdtTransfer(address, amount);

      if (result.success) {
        logger.info(`Consolidation successful: ${result.txId} (${amount / 1e6} USDT)`);
        // Reset balance tracking
        await this.redis.hset('tron:address:balance', address, '0');

        // Record successful consolidation
        await this.redis.rpush('tron:consolidation:history', JSON.stringify({
          address,
          amount,
          txId: result.txId,
          completedAt: Date.now(),
        }));
      } else {
        logger.error(`Consolidation failed for ${address}: ${result.error}`);
        // Re-queue for retry
        await this.redis.rpush('tron:consolidation:queue', JSON.stringify({
          address,
          amount,
          queuedAt: Date.now(),
          retryCount: 1,
        }));
      }

      // Step 5: Undelegate energy after completion (if delegated from hot wallet)
      if (energyDelegated) {
        // Wait a bit for the transfer to be confirmed, then undelegate
        setTimeout(() => {
          this.energyManager.undelegateEnergy(address).catch(err =>
            logger.error(`Undelegate error: ${err.message}`)
          );
        }, 60000); // Undelegate after 1 minute
      }
    } catch (error) {
      logger.error(`Consolidation error for ${address}:`, error.message);
    }
  }

  /**
   * Transfer minimal TRX to user address for bandwidth
   * Only needed if the address has no free bandwidth available
   * @param {string} address
   */
  async transferTrxForBandwidth(address) {
    try {
      const hotWalletTronWeb = new TronWeb({
        fullHost: config.tron.fullNode,
        privateKey: config.wallet.hotWalletPrivateKey,
        headers: config.tron.apiKey ? { 'TRON-PRO-API-KEY': config.tron.apiKey } : {},
      });

      // Send 1 TRX (1,000,000 sun) - this activates the account and provides bandwidth
      // Alternatively send 0 TRX if account is already activated
      const tx = await hotWalletTronWeb.trx.sendTransaction(address, 100000); // 0.1 TRX

      if (tx.result) {
        logger.info(`Sent 0.1 TRX to ${address} for bandwidth (TX: ${tx.txid})`);
      }
    } catch (error) {
      logger.error(`Error sending TRX to ${address}:`, error.message);
    }
  }

  /**
   * Execute TRC-20 USDT transfer from user address to consolidation address
   * @param {string} fromAddress - User address
   * @param {number} amount - USDT amount in sun units
   * @returns {object} { success, txId } or { success: false, error }
   */
  async executeUsdtTransfer(fromAddress, amount) {
    try {
      // Get private key for the user address
      const privateKey = await this.walletManager.getPrivateKey(fromAddress);
      if (!privateKey) {
        return { success: false, error: 'Private key not found' };
      }

      // Create TronWeb instance with user's private key
      const userTronWeb = new TronWeb({
        fullHost: config.tron.fullNode,
        privateKey: privateKey,
        headers: config.tron.apiKey ? { 'TRON-PRO-API-KEY': config.tron.apiKey } : {},
      });

      // Get actual USDT balance on-chain
      const contract = await userTronWeb.contract().at(config.usdt.contractAddress);
      const balance = await contract.balanceOf(fromAddress).call();
      const actualBalance = parseInt(balance.toString(), 10);

      if (actualBalance <= 0) {
        return { success: false, error: 'No USDT balance on-chain' };
      }

      // Transfer all USDT to consolidation address
      const transferAmount = Math.min(amount, actualBalance);

      const tx = await contract.transfer(
        config.wallet.consolidationAddress,
        transferAmount
      ).send({
        feeLimit: 50_000_000, // 50 TRX max fee limit (safety cap)
        callValue: 0,
      });

      logger.info(`USDT transfer TX: ${tx}`);
      return { success: true, txId: tx };
    } catch (error) {
      logger.error(`USDT transfer error from ${fromAddress}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ConsolidationService;
