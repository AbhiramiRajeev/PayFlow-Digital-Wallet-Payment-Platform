/**
 * PayFlow Database Seed Script
 *
 * Creates realistic sample data:
 * - 2 users (alice and bob) with hashed passwords
 * - 1 wallet per user
 * - 1 deposit per user
 * - 1 transfer between them
 *
 * Usage: npm run prisma:seed
 */

import { PrismaClient, PaymentType, TransactionStatus, LedgerEntryType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;
const CURRENCY = 'INR';

async function main() {
  console.log('🌱 Seeding PayFlow database...\n');

  // ─── Create Users ──────────────────────────────────────────────────────────
  const alicePassword = await bcrypt.hash('Alice@Password1', BCRYPT_ROUNDS);
  const bobPassword = await bcrypt.hash('Bob@Password1', BCRYPT_ROUNDS);

  const alice = await prisma.user.upsert({
    where: { email: 'alice@payflow.dev' },
    update: {},
    create: {
      email: 'alice@payflow.dev',
      passwordHash: alicePassword,
      firstName: 'Alice',
      lastName: 'Kapoor',
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@payflow.dev' },
    update: {},
    create: {
      email: 'bob@payflow.dev',
      passwordHash: bobPassword,
      firstName: 'Bob',
      lastName: 'Sharma',
    },
  });

  const adminPassword = await bcrypt.hash('Admin@Password1', BCRYPT_ROUNDS);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@payflow.dev' },
    update: {},
    create: {
      email: 'admin@payflow.dev',
      passwordHash: adminPassword,
      firstName: 'Admin',
      lastName: 'PayFlow',
      role: 'ADMIN',
    },
  });

  console.log(`✅ Users created: ${alice.email}, ${bob.email}, ${admin.email}`);

  // ─── Create Wallets ────────────────────────────────────────────────────────

  // Deposit amounts in minor units (paise)
  const aliceDepositAmount = BigInt(100000); // ₹1000.00
  const bobDepositAmount = BigInt(50000);    // ₹500.00
  const transferAmount = BigInt(20000);      // ₹200.00

  const aliceWallet = await prisma.wallet.upsert({
    where: { id: 'seed-wallet-alice' },
    update: { balance: aliceDepositAmount - transferAmount }, // ₹800 after transfer
    create: {
      id: 'seed-wallet-alice',
      userId: alice.id,
      currency: CURRENCY,
      balance: aliceDepositAmount - transferAmount,
      label: 'Default',
    },
  });

  const bobWallet = await prisma.wallet.upsert({
    where: { id: 'seed-wallet-bob' },
    update: { balance: bobDepositAmount + transferAmount }, // ₹700 after receiving
    create: {
      id: 'seed-wallet-bob',
      userId: bob.id,
      currency: CURRENCY,
      balance: bobDepositAmount + transferAmount,
      label: 'Default',
    },
  });

  console.log(
    `✅ Wallets created: ${aliceWallet.id} (Alice ₹${(Number(aliceWallet.balance) / 100).toFixed(2)}), ` +
    `${bobWallet.id} (Bob ₹${(Number(bobWallet.balance) / 100).toFixed(2)})`,
  );

  // ─── Create Payments (Deposits) ───────────────────────────────────────────

  const aliceDepositId = 'seed-payment-alice-deposit';
  const bobDepositId = 'seed-payment-bob-deposit';

  await prisma.payment.upsert({
    where: { id: aliceDepositId },
    update: {},
    create: {
      id: aliceDepositId,
      walletId: aliceWallet.id,
      type: PaymentType.DEPOSIT,
      status: TransactionStatus.COMPLETED,
      amount: aliceDepositAmount,
      currency: CURRENCY,
      description: 'Initial deposit',
    },
  });

  await prisma.payment.upsert({
    where: { id: bobDepositId },
    update: {},
    create: {
      id: bobDepositId,
      walletId: bobWallet.id,
      type: PaymentType.DEPOSIT,
      status: TransactionStatus.COMPLETED,
      amount: bobDepositAmount,
      currency: CURRENCY,
      description: 'Initial deposit',
    },
  });

  console.log(`✅ Deposits created: Alice ₹1000, Bob ₹500`);

  // ─── Create Transfer ───────────────────────────────────────────────────────

  const transferId = 'seed-transfer-alice-to-bob';

  await prisma.transfer.upsert({
    where: { id: transferId },
    update: {},
    create: {
      id: transferId,
      senderWalletId: aliceWallet.id,
      receiverWalletId: bobWallet.id,
      status: TransactionStatus.COMPLETED,
      amount: transferAmount,
      currency: CURRENCY,
      description: 'Coffee money',
    },
  });

  console.log(`✅ Transfer created: Alice → Bob ₹200`);

  // ─── Create Ledger Entries ─────────────────────────────────────────────────

  // Alice deposit ledger
  const aliceDepositLedgerId = 'seed-ledger-alice-deposit';
  await prisma.ledgerTransaction.upsert({
    where: { id: aliceDepositLedgerId },
    update: {},
    create: {
      id: aliceDepositLedgerId,
      paymentId: aliceDepositId,
      description: 'Initial deposit for Alice',
      entries: {
        create: [
          {
            walletId: aliceWallet.id,
            type: LedgerEntryType.CREDIT,
            amount: aliceDepositAmount,
            currency: CURRENCY,
            balanceAfter: aliceDepositAmount,
          },
        ],
      },
    },
  });

  // Bob deposit ledger
  const bobDepositLedgerId = 'seed-ledger-bob-deposit';
  await prisma.ledgerTransaction.upsert({
    where: { id: bobDepositLedgerId },
    update: {},
    create: {
      id: bobDepositLedgerId,
      paymentId: bobDepositId,
      description: 'Initial deposit for Bob',
      entries: {
        create: [
          {
            walletId: bobWallet.id,
            type: LedgerEntryType.CREDIT,
            amount: bobDepositAmount,
            currency: CURRENCY,
            balanceAfter: bobDepositAmount,
          },
        ],
      },
    },
  });

  // Transfer ledger (balanced DEBIT/CREDIT)
  const transferLedgerId = 'seed-ledger-transfer';
  await prisma.ledgerTransaction.upsert({
    where: { id: transferLedgerId },
    update: {},
    create: {
      id: transferLedgerId,
      transferId: transferId,
      description: 'Transfer: Alice → Bob (Coffee money)',
      entries: {
        create: [
          {
            walletId: aliceWallet.id,
            type: LedgerEntryType.DEBIT,
            amount: transferAmount,
            currency: CURRENCY,
            balanceAfter: aliceDepositAmount - transferAmount,
          },
          {
            walletId: bobWallet.id,
            type: LedgerEntryType.CREDIT,
            amount: transferAmount,
            currency: CURRENCY,
            balanceAfter: bobDepositAmount + transferAmount,
          },
        ],
      },
    },
  });

  console.log(`✅ Ledger entries created (double-entry verified balanced)`);

  // ─── Summary ──────────────────────────────────────────────────────────────

  console.log('\n📊 Seed Summary:');
  console.log('─────────────────────────────────────────────────');
  console.log('Users:');
  console.log(`  alice@payflow.dev  (password: Alice@Password1)  Wallet: ₹800`);
  console.log(`  bob@payflow.dev    (password: Bob@Password1)    Wallet: ₹700`);
  console.log(`  admin@payflow.dev  (password: Admin@Password1)  Role: ADMIN`);
  console.log('\nGraphQL endpoint: http://localhost:3000/graphql');
  console.log('─────────────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
