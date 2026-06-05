/**
 * Deposit Monitor - Poll TronGrid for TRC-20 USDT transfers to monitored addresses
 */
const TronWeb = require('tronweb');
const config = require('./config');
const logger = require('./logger');

class DepositMonitor {
  constructor(redisClient, walletManager, consolidationService) {
    this.redis = redisClient;
    this.walletManager = walletManager;
    this.consolidationService = consolidationService;
    this.tronWeb = new TronWeb({
      fullHost: config.tron.fullNode,
      headers: config.tron.apiKey ? { 'TRON-PRO-API-KEY': config.tron.apiKey } : {},
    });
    this.polling = false;
  }

  /**
   * Start polling for deposits
   */
  async start() {
    this.polling = true;
    logger.info('Deposit monitor started');
    await this.pollLoop();
  }

  /**
   * Stop polling
   */
  stop() {
    this.polling = false;
    logger.info('Deposit monitor stopped');
  }

  /**
   * Main polling loop
   */
  async pollLoop() {
    while (this.polling) {
      try {
        await this.checkDeposits();
      } catch (error) {
        logger.error('Error checking deposits:', error.message);
      }
      await this.sleep(config.service.pollIntervalMs);
    }
  }

  /**
   * Check for new USDT deposits on all monitored addresses
   */
  async checkDeposits() {
    const addresses = await this.walletManager.getMonitoredAddresses();
    if (addresses.length === 0) return;

    // Get last checked timestamp
    const lastChecked = await this.redis.get('tron:last_checked_timestamp') || (Date.now() - 3600000).toString();
    const minTimestamp = parseInt(lastChecked, 10);

    for (const address of addresses) {
      await this.checkAddressDeposits(address, minTimestamp);
    }

    // Update last checked timestamp
    await this.redis.set('tron:last_checked_timestamp', Date.now().toString());
  }

  /**
   * Check deposits for a specific address using TronGrid API
   * @param {string} address - TRON address to check
   * @param {number} minTimestamp - Only check transfers after this timestamp
   */
  async checkAddressDeposits(address, minTimestamp) {
    try {
      // Query TRC-20 transfer events for this address
      const url = `${config.tron.fullNode}/v1/accounts/${address}/transactions/trc20`;
      const params = new URLSearchParams({
        only_to: 'true',
        contract_address: config.usdt.contractAddress,
        min_timestamp: minTimestamp.toString(),
        limit: '50',
        order_by: 'block_timestamp,asc',
      });

      const response = await fetch(`${url}?${params}`, {
        headers: config.tron.apiKey ? { 'TRON-PRO-API-KEY': config.tron.apiKey } : {},
      });

      if (!response.ok) {
        logger.error(`TronGrid API error for ${address}: ${response.status}`);
        return;
      }

      const data = await response.json();
      if (!data.data || data.data.length === 0) return;

      for (const tx of data.data) {
        await this.processDeposit(address, tx);
      }
    } catch (error) {
      logger.error(`Error checking deposits for ${address}:`, error.message);
    }
  }

  /**
   * Process a single deposit transaction
   * @param {string} address - Receiving address
   * @param {object} tx - Transaction data from TronGrid
   */
  async processDeposit(address, tx) {
    const txId = tx.transaction_id;
    const amount = parseInt(tx.value, 10);

    // Check if already processed
    const processed = await this.redis.sismember('tron:processed:txids', txId);
    if (processed) return;

    // Verify confirmations
    const currentBlock = await this.tronWeb.trx.getCurrentBlock();
    const currentBlockNum = currentBlock.block_header.raw_data.number;
    const txInfo = await this.tronWeb.trx.getTransactionInfo(txId);

    if (!txInfo || !txInfo.blockNumber) return;

    const confirmations = currentBlockNum - txInfo.blockNumber;
    if (confirmations < config.service.confirmationsRequired) {
      logger.info(`TX ${txId} has ${confirmations} confirmations, waiting for ${config.service.confirmationsRequired}`);
      return;
    }

    // Mark as processed
    await this.redis.sadd('tron:processed:txids', txId);

    logger.info(`Deposit confirmed: ${amount / 1e6} USDT to ${address} (TX: ${txId})`);

    // Update balance and trigger consolidation if threshold met
    const balance = await this.redis.hincrby('tron:address:balance', address, amount);

    if (balance >= config.usdt.minAmountToConsolidate) {
      logger.info(`Balance ${balance / 1e6} USDT >= threshold, queuing consolidation for ${address}`);
      await this.consolidationService.queueConsolidation(address, balance);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = DepositMonitor;
