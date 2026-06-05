# TRON USDT 支付服务

低手续费（< 3 TRX）的 TRON USDT 充值与自动归集服务。

## 功能

- **HD 钱包地址生成** — 为每个用户生成独立的 TRC-20 充值地址
- **链上监听** — 实时监听用户地址的 USDT 入账事件
- **自动归集** — 收到 USDT 后自动转入归集地址
- **能量优化** — 通过能量委托/租赁将手续费降至 1-3 TRX

## 手续费优化策略

| 策略 | 成本 | 说明 |
|------|------|------|
| 直接燃烧 TRX | ~13-27 TRX | ❌ 不推荐 |
| 质押 TRX 委托能量 | ~0 TRX | ✅ 需要锁仓大量 TRX |
| 第三方能量租赁 | ~1-2 TRX | ✅ 推荐方案 |

### 归集流程

```
用户地址收到 USDT（确认 19 个区块）
    ↓
为用户地址委托/租赁 65,000 能量（~1-2 TRX）
    ↓
检查带宽（使用免费带宽或转入 0.1 TRX）
    ↓
从用户地址转 USDT 到归集地址
    ↓
取消能量委托（归还热钱包）
    ↓
总成本: ≈ 1-3 TRX ✅
```

## 安装

```bash
cd tron-payment-service
npm install
```

## 配置

复制环境变量模板并填入配置：

```bash
cp .env.example .env
```

关键配置项：
- `MNEMONIC` — HD 钱包助记词（务必保密）
- `HOT_WALLET_PRIVATE_KEY` — 热钱包私钥（用于能量委托和 TRX 转账）
- `CONSOLIDATION_ADDRESS` — USDT 归集地址
- `TRON_API_KEY` — TronGrid API Key
- `ENERGY_RENTAL_API_URL` — 能量租赁 API 地址（可选）

## 运行

```bash
# 生产环境
npm start

# 开发环境（自动重载）
npm run dev
```

## 架构

```
src/
├── index.js          # 主入口，服务编排
├── config.js         # 配置管理
├── logger.js         # 日志
├── wallet.js         # HD 钱包地址生成与管理
├── monitor.js        # 链上 USDT 充值监听
├── energy.js         # 能量委托与租赁管理
└── consolidation.js  # 自动归集服务
```

## API 接口

服务启动后可通过代码调用：

```javascript
const TronPaymentService = require('./src/index');
const service = new TronPaymentService();

// 为用户生成充值地址
const { address } = await service.createDepositAddress('user123');

// 查询用户充值地址
const addr = await service.getDepositAddress('user123');

// 查询余额
const balance = await service.getBalance(address);

// 手动触发归集
await service.triggerConsolidation(address);
```

## 依赖

- **tronweb** — TRON 区块链交互
- **bip39 + hdkey** — HD 钱包地址派生
- **ioredis** — Redis 客户端（地址管理、队列）
- **winston** — 日志
- **dotenv** — 环境变量管理

## 安全注意事项

1. **助记词和私钥** 必须使用 KMS 或硬件安全模块存储，生产环境不要明文存储在 .env 中
2. **Redis** 需要设置密码并限制访问
3. 建议使用 **多签钱包** 作为归集地址
4. 定期轮换热钱包
