require('dotenv').config();

module.exports = {
  tron: {
    fullNode: process.env.TRON_FULL_NODE || 'https://api.trongrid.io',
    solidityNode: process.env.TRON_SOLIDITY_NODE || 'https://api.trongrid.io',
    eventServer: process.env.TRON_EVENT_SERVER || 'https://api.trongrid.io',
    apiKey: process.env.TRON_API_KEY,
  },
  wallet: {
    mnemonic: process.env.MNEMONIC,
    hotWalletPrivateKey: process.env.HOT_WALLET_PRIVATE_KEY,
    consolidationAddress: process.env.CONSOLIDATION_ADDRESS,
    // BIP-44 path for TRON: m/44'/195'/0'/0/x
    hdPath: "m/44'/195'/0'/0",
  },
  usdt: {
    contractAddress: process.env.USDT_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    // Minimum USDT amount to trigger consolidation (in sun, 1 USDT = 1000000)
    minAmountToConsolidate: parseInt(process.env.MIN_USDT_TO_CONSOLIDATE || '1000000', 10),
  },
  energy: {
    rentalApiUrl: process.env.ENERGY_RENTAL_API_URL,
    rentalApiKey: process.env.ENERGY_RENTAL_API_KEY,
    // Energy needed for a TRC-20 transfer (~65,000 for USDT)
    requiredEnergy: parseInt(process.env.ENERGY_REQUIRED || '65000', 10),
  },
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  service: {
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '10000', 10),
    confirmationsRequired: parseInt(process.env.CONFIRMATIONS_REQUIRED || '19', 10),
  },
};
