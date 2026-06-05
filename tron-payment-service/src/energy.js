/**
 * Energy Manager - Handle energy delegation and rental for low-fee transactions
 * 
 * Strategies:
 * 1. Delegate energy from hot wallet (Stake 2.0 delegateResource)
 * 2. Rent energy from third-party marketplace API
 */
const TronWeb = require('tronweb');
const config = require('./config');
const logger = require('./logger');

class EnergyManager {
  constructor() {
    this.tronWeb = new TronWeb({
      fullHost: config.tron.fullNode,
      privateKey: config.wallet.hotWalletPrivateKey,
      headers: config.tron.apiKey ? { 'TRON-PRO-API-KEY': config.tron.apiKey } : {},
    });
  }

  /**
   * Get account resources (bandwidth & energy) for an address
   * @param {string} address
   * @returns {object} { bandwidth, energy, freeNetUsed, freeNetLimit }
   */
  async getAccountResources(address) {
    try {
      const resources = await this.tronWeb.trx.getAccountResources(address);
      return {
        energy: (resources.EnergyLimit || 0) - (resources.EnergyUsed || 0),
        bandwidth: (resources.freeNetLimit || 1500) - (resources.freeNetUsed || 0),
        totalEnergy: resources.EnergyLimit || 0,
        totalBandwidth: resources.freeNetLimit || 1500,
      };
    } catch (error) {
      logger.error(`Error getting resources for ${address}:`, error.message);
      return { energy: 0, bandwidth: 0, totalEnergy: 0, totalBandwidth: 0 };
    }
  }

  /**
   * Delegate energy from hot wallet to target address using Stake 2.0
   * This is the cheapest method if hot wallet has staked TRX
   * @param {string} targetAddress - Address to receive energy delegation
   * @param {number} energyAmount - Amount of energy to delegate
   * @returns {object} { success, txId, cost }
   */
  async delegateEnergy(targetAddress, energyAmount = config.energy.requiredEnergy) {
    try {
      // Check if hot wallet has enough delegatable energy
      const hotWalletAddress = this.tronWeb.defaultAddress.base58;
      const resources = await this.getAccountResources(hotWalletAddress);

      if (resources.energy >= energyAmount) {
        // Use Stake 2.0 delegateResource to delegate energy
        const tx = await this.tronWeb.transactionBuilder.delegateResource(
          energyAmount,
          targetAddress,
          'ENERGY',
          hotWalletAddress
        );
        const signedTx = await this.tronWeb.trx.sign(tx);
        const result = await this.tronWeb.trx.sendRawTransaction(signedTx);

        if (result.result) {
          logger.info(`Delegated ${energyAmount} energy to ${targetAddress}, TX: ${result.txid}`);
          return { success: true, txId: result.txid, cost: 0, method: 'delegation' };
        }
      }

      // Fallback to energy rental if delegation not available
      logger.info(`Hot wallet energy insufficient, falling back to energy rental`);
      return await this.rentEnergy(targetAddress, energyAmount);
    } catch (error) {
      logger.error(`Error delegating energy to ${targetAddress}:`, error.message);
      // Fallback to rental
      return await this.rentEnergy(targetAddress, energyAmount);
    }
  }

  /**
   * Rent energy from third-party marketplace
   * Cost: ~1-2 TRX per 65,000 energy
   * @param {string} targetAddress
   * @param {number} energyAmount
   * @returns {object} { success, txId, cost }
   */
  async rentEnergy(targetAddress, energyAmount = config.energy.requiredEnergy) {
    try {
      if (!config.energy.rentalApiUrl) {
        logger.warn('Energy rental API not configured, will burn TRX for energy');
        return { success: false, method: 'none', cost: 0 };
      }

      const authHeader = 'Bearer ' + config.energy.rentalApiKey;
      const response = await fetch(`${config.energy.rentalApiUrl}/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify({
          target_address: targetAddress,
          energy_amount: energyAmount,
          duration_hours: 1, // 1 hour is enough for consolidation
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Energy rental API error: ${response.status} - ${errorText}`);
        return { success: false, method: 'rental_failed', cost: 0 };
      }

      const data = await response.json();
      logger.info(`Rented ${energyAmount} energy for ${targetAddress}, cost: ${data.cost_trx} TRX, order: ${data.order_id}`);

      return {
        success: true,
        txId: data.order_id,
        cost: data.cost_trx,
        method: 'rental',
      };
    } catch (error) {
      logger.error(`Error renting energy for ${targetAddress}:`, error.message);
      return { success: false, method: 'rental_error', cost: 0 };
    }
  }

  /**
   * Undelegate energy after consolidation is complete
   * @param {string} targetAddress
   * @param {number} energyAmount
   */
  async undelegateEnergy(targetAddress, energyAmount = config.energy.requiredEnergy) {
    try {
      const hotWalletAddress = this.tronWeb.defaultAddress.base58;
      const tx = await this.tronWeb.transactionBuilder.undelegateResource(
        energyAmount,
        targetAddress,
        'ENERGY',
        hotWalletAddress
      );
      const signedTx = await this.tronWeb.trx.sign(tx);
      const result = await this.tronWeb.trx.sendRawTransaction(signedTx);

      if (result.result) {
        logger.info(`Undelegated ${energyAmount} energy from ${targetAddress}`);
      }
    } catch (error) {
      logger.error(`Error undelegating energy from ${targetAddress}:`, error.message);
    }
  }
}

module.exports = EnergyManager;
