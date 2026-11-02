# PayFlow — Digital Wallet & Payment Processing Platform

> A production-grade backend engineering portfolio project built with NestJS, GraphQL, PostgreSQL, Redis, and Kafka.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Features](#2-features)
3. [Technology Stack](#3-technology-stack)
4. [Architecture](#4-architecture)
5. [Database Schema](#5-database-schema)
6. [Payment & Transfer Sequence Diagrams](#6-payment--transfer-sequence-diagrams)
7. [GraphQL API Examples](#7-graphql-api-examples)
8. [Local Setup Instructions](#8-local-setup-instructions)
9. [Environment Configuration](#9-environment-configuration)
10. [Database Migrations](#10-database-migrations)
11. [Testing](#11-testing)
12. [Kafka Event Flow](#12-kafka-event-flow)
13. [Idempotency Design](#13-idempotency-design)
14. [Double-Entry Ledger](#14-double-entry-ledger)
15. [Concurrency & Consistency Decisions](#15-concurrency--consistency-decisions)
16. [Known Limitations & Future Improvements](#16-known-limitations--future-improvements)

---

## 1. Project Overview

PayFlow is a fintech-grade digital wallet and payment processing backend. It demonstrates real-world engineering patterns used in production financial systems:

- **Transactional consistency** — all money movements are atomic PostgreSQL transactions
- **Double-entry bookkeeping** — every payment produces balanced ledger entries
- **Idempotency** — payment and transfer mutations are safely retryable
- **Outbox pattern** — Kafka events are published reliably without distributed coordination
- **Concurrency safety** — `SELECT FOR UPDATE` locking prevents double-spending
- **Redis caching** — wallet balance reads are cached with TTL and invalidated on writes
- **Role-based access control** — admin vs. user authorization on GraphQL resolvers

---

## 2. Features

| Feature | Status |
|---|---|
| User registration & login with bcrypt | ✅ |
| JWT authentication | ✅ |
| Role-based authorization (USER/ADMIN) | ✅ |
| Automatic wallet creation on registration | ✅ |
| Multiple wallets per user | ✅ |
| Add funds (simulated deposit) | ✅ |
| Transfer funds between wallets | ✅ |
| Transfer reversal (compensating transaction) | ✅ |
| Double-entry ledger (balanced DEBIT/CREDIT) | ✅ |
| Idempotency for payments & transfers | ✅ |
| Transaction history query | ✅ |
| Redis balance cache with invalidation | ✅ |
| Transactional outbox pattern | ✅ |
| Kafka event publishing | ✅ |
| Kafka notification consumer | ✅ |
| Dead-letter topic (DLQ) for failed events | ✅ |
| Docker Compose for full stack | ✅ |
| Seed data | ✅ |
| Unit tests | ✅ |

---

## 3. Technology Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.x (strict mode) |
| Runtime | Node.js 20 LTS |
| Framework | NestJS 10 |
| API | GraphQL (Apollo Server 4, code-first) |
| Database | PostgreSQL 16 |
| ORM | Prisma 5 |
| Cache | Redis 7 (ioredis) |
| Messaging | Apache Kafka 7 (KafkaJS) |
| Auth | JWT + bcrypt (12 rounds) |
| Validation | class-validator + class-transformer |
| Testing | Jest 29 |
| Containerization | Docker + Docker Compose |

---

## 4. Architecture

### Module Dependency Diagram

```mermaid
graph TD
    AppModule --> CommonModule
    AppModule --> KafkaModule
    AppModule --> AuthModule
    AppModule --> UsersModule
    AppModule --> WalletsModule
    AppModule --> PaymentsModule
    AppModule --> LedgerModule
    AppModule --> TransactionsModule
    AppModule --> NotificationsModule

    AuthModule --> UsersModule
    AuthModule --> WalletsModule
    PaymentsModule --> WalletsModule
    PaymentsModule --> LedgerModule
    PaymentsModule --> TransactionsModule

    CommonModule --> PrismaService
    CommonModule --> RedisService

    KafkaModule --> KafkaProducerService
    KafkaModule --> OutboxProcessorService

    subgraph Infrastructure
        PrismaService[PostgreSQL via Prisma]
        RedisService[Redis via ioredis]
        KafkaProducerService[Kafka Producer]
    end
```

### Request Flow

```mermaid
graph LR
    Client -->|GraphQL over HTTP| Resolver
    Resolver -->|Auth| JwtAuthGuard
    JwtAuthGuard --> Resolver
    Resolver --> Service
    Service -->|Atomic transaction| PostgreSQL
    Service -->|Cache read/write| Redis
    PostgreSQL -->|Outbox event written| OutboxTable
    OutboxProcessor -->|Poll every 5s| OutboxTable
    OutboxProcessor -->|Publish| Kafka
    Kafka -->|Consume| NotificationsConsumer
    NotificationsConsumer -->|Write| NotificationsTable
```

---

## 5. Database Schema

```mermaid
erDiagram
    User {
        uuid id PK
        string email UK
        string passwordHash
        string firstName
        string lastName
        enum role
        bool isActive
        datetime createdAt
        datetime updatedAt
    }

    Wallet {
        uuid id PK
        uuid userId FK
        string currency
        bigint balance
        enum status
        string label
        datetime createdAt
        datetime updatedAt
    }

    Payment {
        uuid id PK
        uuid walletId FK
        enum type
        enum status
        bigint amount
        string currency
        string description
        string idempotencyKey UK
        uuid reversedPaymentId UK
        datetime createdAt
        datetime updatedAt
    }

    Transfer {
        uuid id PK
        uuid senderWalletId FK
        uuid receiverWalletId FK
        enum status
        bigint amount
        string currency
        string idempotencyKey UK
        uuid reversedTransferId UK
        datetime createdAt
        datetime updatedAt
    }

    LedgerTransaction {
        uuid id PK
        uuid paymentId UK FK
        uuid transferId UK FK
        string description
        datetime createdAt
    }

    LedgerEntry {
        uuid id PK
        uuid ledgerTransactionId FK
        uuid walletId FK
        enum type
        bigint amount
        bigint balanceAfter
        datetime createdAt
    }

    IdempotencyRecord {
        uuid id PK
        string key UK
        string requestHash
        json responseBody
        string operationType
        datetime expiresAt
        datetime createdAt
    }

    OutboxEvent {
        uuid id PK
        string topic
        json payload
        enum status
        uuid paymentId FK
        uuid transferId FK
        int attempts
        string lastError
        datetime processedAt
        datetime createdAt
    }

    Notification {
        uuid id PK
        uuid userId FK
        string title
        string body
        enum status
        json metadata
        datetime createdAt
    }

    User ||--o{ Wallet : "owns"
    User ||--o{ Notification : "receives"
    Wallet ||--o{ Payment : "has"
    Wallet ||--o{ Transfer : "sends"
    Wallet ||--o{ Transfer : "receives"
    Wallet ||--o{ LedgerEntry : "has"
    Payment ||--o| LedgerTransaction : "produces"
    Transfer ||--o| LedgerTransaction : "produces"
    LedgerTransaction ||--o{ LedgerEntry : "contains"
    Payment ||--o{ OutboxEvent : "emits"
    Transfer ||--o{ OutboxEvent : "emits"
```

---

## 6. Payment & Transfer Sequence Diagrams

### Add Funds (Deposit)

```mermaid
sequenceDiagram
    participant Client
    participant Resolver
    participant PaymentsService
    participant IdempotencyService
    participant PostgreSQL
    participant RedisCache
    participant OutboxProcessor
    participant Kafka

    Client->>Resolver: addFunds(walletId, amount, idempotencyKey?)
    Resolver->>PaymentsService: addFunds(userId, input)
    PaymentsService->>IdempotencyService: check(key, hash, "addFunds")
    alt Key already exists
        IdempotencyService-->>PaymentsService: cachedResponse
        PaymentsService-->>Client: (replayed result)
    else New request
        PaymentsService->>PostgreSQL: BEGIN SERIALIZABLE TRANSACTION
        PostgreSQL->>PostgreSQL: SELECT wallet FOR UPDATE
        PostgreSQL->>PostgreSQL: INSERT payment (PENDING)
        PostgreSQL->>PostgreSQL: UPDATE wallet.balance += amount
        PostgreSQL->>PostgreSQL: INSERT ledger_transaction + entry (CREDIT)
        PostgreSQL->>PostgreSQL: INSERT outbox_event (PENDING)
        PostgreSQL->>PostgreSQL: UPDATE payment status = COMPLETED
        PostgreSQL->>PostgreSQL: COMMIT
        PaymentsService->>RedisCache: DEL wallet:balance:{id}
        PaymentsService->>IdempotencyService: store(key, hash, result)
        PaymentsService-->>Client: PaymentResult
        OutboxProcessor->>PostgreSQL: SELECT outbox_events WHERE status=PENDING
        OutboxProcessor->>Kafka: publish payment.completed
        OutboxProcessor->>PostgreSQL: UPDATE outbox_event status=PUBLISHED
    end
```

### Transfer Funds

```mermaid
sequenceDiagram
    participant Client
    participant Resolver
    participant PaymentsService
    participant PostgreSQL
    participant RedisCache
    participant Kafka

    Client->>Resolver: transferFunds(senderWalletId, receiverWalletId, amount)
    Resolver->>PaymentsService: transferFunds(userId, input)
    PaymentsService->>PaymentsService: validate ownership + wallet status
    PaymentsService->>PostgreSQL: BEGIN SERIALIZABLE TRANSACTION
    Note over PostgreSQL: Lock wallets in sorted ID order (deadlock prevention)
    PostgreSQL->>PostgreSQL: SELECT wallets WHERE id IN (...) ORDER BY id FOR UPDATE
    PostgreSQL->>PostgreSQL: Validate sender balance >= amount
    PostgreSQL->>PostgreSQL: INSERT transfer (PENDING)
    PostgreSQL->>PostgreSQL: UPDATE sender.balance -= amount
    PostgreSQL->>PostgreSQL: UPDATE receiver.balance += amount
    PostgreSQL->>PostgreSQL: INSERT ledger_transaction
    PostgreSQL->>PostgreSQL: INSERT ledger_entry DEBIT (sender)
    PostgreSQL->>PostgreSQL: INSERT ledger_entry CREDIT (receiver)
    PostgreSQL->>PostgreSQL: INSERT outbox_event (PENDING)
    PostgreSQL->>PostgreSQL: UPDATE transfer status = COMPLETED
    PostgreSQL->>PostgreSQL: COMMIT
    PaymentsService->>RedisCache: DEL wallet:balance:{sender}
    PaymentsService->>RedisCache: DEL wallet:balance:{receiver}
    PaymentsService-->>Client: TransferResult
    Note over Kafka: Outbox processor publishes transfer.completed asynchronously
```

---

## 7. GraphQL API Examples

### Register

```graphql
mutation Register {
  register(input: {
    email: "alice@example.com"
    password: "Alice@Password1"
    firstName: "Alice"
    lastName: "Kapoor"
  }) {
    accessToken
    tokenType
    expiresIn
    user {
      id
      email
      role
    }
  }
}
```

### Login

```graphql
mutation Login {
  login(input: {
    email: "alice@payflow.dev"
    password: "Alice@Password1"
  }) {
    accessToken
    user { id email }
  }
}
```

> All subsequent requests require:
> `Authorization: Bearer <accessToken>`

### Get My Profile

```graphql
query Me {
  me {
    id
    email
    firstName
    lastName
    role
  }
}
```

### List My Wallets

```graphql
query MyWallets {
  myWallets {
    id
    currency
    balance
    status
    label
  }
}
```

### Check Wallet Balance (with Redis caching)

```graphql
query WalletBalance {
  walletBalance(walletId: "seed-wallet-alice") {
    walletId
    balance
    currency
    cachedAt
  }
}
```

### Add Funds

```graphql
mutation AddFunds {
  addFunds(input: {
    walletId: "seed-wallet-alice"
    amount: 500.00
    description: "Top up"
    idempotencyKey: "deposit-001"
  }) {
    id
    status
    amount
    currency
    createdAt
  }
}
```

### Transfer Funds

```graphql
mutation Transfer {
  transferFunds(input: {
    senderWalletId: "seed-wallet-alice"
    receiverWalletId: "seed-wallet-bob"
    amount: 100.00
    description: "Lunch split"
    idempotencyKey: "transfer-001"
  }) {
    id
    status
    amount
    senderWalletId
    receiverWalletId
    createdAt
  }
}
```

### Reverse Transfer

```graphql
mutation Reverse {
  reverseTransfer(input: {
    transferId: "seed-transfer-alice-to-bob"
    reason: "Incorrect amount"
    idempotencyKey: "reverse-001"
  }) {
    id
    status
    amount
    createdAt
  }
}
```

### Transaction History

```graphql
query History {
  transactionHistory(walletId: "seed-wallet-alice", limit: 10) {
    total
    payments {
      id
      type
      status
      amount
      createdAt
    }
    transfers {
      id
      status
      amount
      senderWalletId
      receiverWalletId
      createdAt
    }
  }
}
```

---

## 8. Local Setup Instructions

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- npm

### Option A — Full Docker Setup (recommended)

```bash
# 1. Clone the repository
git clone <repo-url>
cd payflow

# 2. Copy environment file
cp .env.example .env

# 3. Start all services (PostgreSQL, Redis, Kafka, Zookeeper, App)
docker-compose up -d

# 4. Wait for services to be healthy (~30 seconds), then run migrations + seed
docker-compose exec app npx prisma migrate deploy
docker-compose exec app npm run prisma:seed

# 5. GraphQL Playground is available at:
#    http://localhost:3000/graphql
```

### Option B — Local Node.js + Docker infrastructure

```bash
# 1. Start only infrastructure services
docker-compose up -d postgres redis kafka zookeeper

# 2. Install dependencies
npm install

# 3. Copy and configure .env
cp .env.example .env
# Edit .env — set KAFKA_BROKERS=localhost:29092

# 4. Generate Prisma client
npm run prisma:generate

# 5. Run database migrations
npm run prisma:migrate

# 6. Seed the database
npm run prisma:seed

# 7. Start the application
npm run start:dev

# GraphQL Playground: http://localhost:3000/graphql
```

### Seed Users

| Email | Password | Role |
|---|---|---|
| `alice@payflow.dev` | `Alice@Password1` | USER |
| `bob@payflow.dev` | `Bob@Password1` | USER |
| `admin@payflow.dev` | `Admin@Password1` | ADMIN |

---

## 9. Environment Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://payflow:payflow_secret@localhost:5432/payflow_db` | PostgreSQL connection string |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | `redis_secret` | Redis password |
| `REDIS_WALLET_BALANCE_TTL` | `300` | Wallet balance cache TTL (seconds) |
| `REDIS_USER_TTL` | `600` | User data cache TTL (seconds) |
| `KAFKA_BROKERS` | `localhost:29092` | Kafka broker addresses (comma-separated) |
| `KAFKA_CLIENT_ID` | `payflow-app` | Kafka client identifier |
| `KAFKA_GROUP_ID` | `payflow-consumers` | Kafka consumer group |
| `KAFKA_DLT_SUFFIX` | `.dlq` | Suffix for dead-letter topics |
| `OUTBOX_POLL_INTERVAL_MS` | `5000` | Outbox processor poll interval |
| `OUTBOX_MAX_RETRIES` | `3` | Max retry attempts before DLQ |
| `JWT_SECRET` | *(must change)* | JWT signing secret (min 32 chars) |
| `JWT_EXPIRES_IN` | `7d` | JWT expiry duration |
| `IDEMPOTENCY_TTL_SECONDS` | `86400` | Idempotency key retention (24h) |
| `PORT` | `3000` | Application HTTP port |

> ⚠️ **Production**: Always set a cryptographically random `JWT_SECRET`.

---

## 10. Database Migrations

```bash
# Create a new migration (development)
npx prisma migrate dev --name your_migration_name

# Apply migrations in production (CI/CD)
npx prisma migrate deploy

# Reset database (drops all data — development only!)
npm run db:reset

# Open Prisma Studio (database GUI)
npm run prisma:studio

# Regenerate Prisma client after schema changes
npm run prisma:generate
```

---

## 11. Testing

```bash
# Run all unit tests
npm test

# Run tests with coverage report
npm run test:cov

# Run tests in watch mode
npm run test:watch
```

### Test Coverage

| Test File | What It Covers |
|---|---|
| `auth/auth.service.spec.ts` | Registration, login, JWT creation, suspended account, email enumeration prevention |
| `wallets/wallets.service.spec.ts` | Wallet creation, balance caching, ownership, status validation, minor unit conversion |
| `payments/payments.service.spec.ts` | Deposits, transfers, insufficient balance, idempotency replay, reversal, double-reversal protection |
| `payments/idempotency.service.spec.ts` | Key lookup, hash mismatch rejection, concurrent duplicate handling (P2002) |
| `ledger/ledger.service.spec.ts` | Balanced/unbalanced entry detection, DEBIT/CREDIT structure, zero/negative amount rejection |

---

## 12. Kafka Event Flow

### Topics

| Topic | Producer | Consumer | Description |
|---|---|---|---|
| `payment.completed` | OutboxProcessor | NotificationsConsumer | Fired after a successful deposit |
| `payment.failed` | OutboxProcessor | *(future)* | Fired when payment processing fails |
| `payment.initiated` | OutboxProcessor | *(future)* | Fired when payment processing begins |
| `transfer.completed` | OutboxProcessor | NotificationsConsumer | Fired after a successful transfer |
| `transfer.reversed` | OutboxProcessor | NotificationsConsumer | Fired after a transfer reversal |

### Dead-Letter Topics (DLQ)

If a Kafka send fails after `OUTBOX_MAX_RETRIES` attempts, the event is published to:
- `payment.completed.dlq`
- `transfer.completed.dlq`
- etc.

Failed outbox events are marked `FAILED` in the database for manual investigation.

### Delivery Guarantees

| Guarantee | How |
|---|---|
| At-least-once delivery | Outbox processor retries on Kafka publish failure |
| No lost events | Events written atomically with DB transaction; never before commit |
| Idempotent consumers | `NotificationsConsumer` tracks processed `eventId` values in memory |
| Exactly-once processing | Idempotent consumer + idempotent Kafka producer (enabled) |

---

## 13. Idempotency Design

### Problem

Financial operations must be safely retryable. A network timeout after the server processes a transfer should not result in a double charge.

### Implementation

1. **Client sends** `idempotencyKey` (any unique string, e.g. UUID) with the request.
2. **Server hashes** the entire request payload with SHA-256.
3. **Before processing**, the server checks the `idempotency_records` table:
   - Key not found → proceed normally.
   - Key found + hash matches → replay the stored response immediately (no DB changes).
   - Key found + hash differs → reject with `409 CONFLICT` (different payload detected).
4. **After success**, the server stores `{ key, requestHash, operationType, responseBody, expiresAt }`.
5. **Concurrent duplicates** are handled by the `UNIQUE` constraint on `key` — the second writer receives a `P2002` error, which is silently ignored (the first request will have stored the result).

### Scope

Idempotency is implemented for: `addFunds`, `transferFunds`, `reverseTransfer`.

Keys expire after `IDEMPOTENCY_TTL_SECONDS` (default 24h). Expired keys are not automatically cleaned up in this version (see [Known Limitations](#16-known-limitations--future-improvements)).

---

## 14. Double-Entry Ledger

### Principle

Every financial event produces a `LedgerTransaction` with **balanced** `LedgerEntry` rows.

For every ₹1 that leaves one wallet, ₹1 enters another. This is the accounting identity:

```
Total DEBIT entries = Total CREDIT entries  (for all transfers)
```

### Entry Semantics

| Entry Type | Direction | Example |
|---|---|---|
| `DEBIT` | Funds leave the wallet | Sender in a transfer |
| `CREDIT` | Funds enter the wallet | Receiver in a transfer, deposit recipient |

### Deposit Example

A ₹1000 deposit to Alice's wallet creates:
```
LedgerTransaction (payment_id = P1)
  LedgerEntry: wallet=alice, type=CREDIT, amount=100000, balanceAfter=100000
```

*(Single-sided: deposits don't have a corresponding "other" user wallet — they represent an external inflow.)*

### Transfer Example

A ₹200 transfer from Alice → Bob creates:
```
LedgerTransaction (transfer_id = T1)
  LedgerEntry: wallet=alice, type=DEBIT,  amount=20000, balanceAfter=80000
  LedgerEntry: wallet=bob,   type=CREDIT, amount=20000, balanceAfter=70000
```

**Balance invariant**: `DEBIT.amount == CREDIT.amount` (enforced by `LedgerService.assertBalanced`)

### Immutability

`LedgerEntry` rows are **never updated or deleted**. Reversals create **new compensating entries** in the opposite direction.

### Balance Calculation

```
wallet.balance = SUM(CREDIT entries) - SUM(DEBIT entries)
```

The `wallet.balance` column is kept in sync via the DB transaction. The ledger entries are an audit trail that must independently reconcile to the same total.

### Why BigInt?

All monetary amounts are stored as `BigInt` in **minor units** (paise for INR, cents for USD):
- ₹100.50 → stored as `10050`
- Avoids all floating-point precision errors
- Converted to/from decimal in the GraphQL API layer only

---

## 15. Concurrency & Consistency Decisions

### Isolation Level: SERIALIZABLE

All financial transactions use `Prisma.TransactionIsolationLevel.Serializable`. This is the strictest PostgreSQL isolation level and prevents:
- **Dirty reads** — reading uncommitted data from another transaction
- **Non-repeatable reads** — reading different values on re-read within a transaction
- **Phantom reads** — seeing new rows inserted by concurrent transactions

### Locking Strategy: SELECT FOR UPDATE

Within each transaction, we explicitly lock wallet rows:

```sql
SELECT id FROM wallets WHERE id IN (:id1, :id2) ORDER BY id FOR UPDATE
```

**Why ORDER BY id?** Deadlock prevention. If two concurrent transfers involve the same two wallets (A→B and B→A), both will attempt to lock A first (smaller UUID), then B. Without ordering, A→B locks A then waits for B, while B→A locks B then waits for A — classic deadlock.

### Balance Validation Inside the Lock

Balance validation is done **inside the locked transaction**, after `FOR UPDATE`:

```
1. Lock wallet rows
2. Re-read current balance (inside transaction)
3. Validate balance >= amount
4. Deduct/credit
```

This prevents a race condition where two concurrent transfers both read ₹500, both pass the ₹400 validation, and both deduct ₹400, resulting in a ₹-300 balance.

### Partial Failure Handling

All changes within a transfer (balance updates, ledger entries, outbox event) are in a single `$transaction` block. If any step fails:
- PostgreSQL rolls back the entire transaction
- No money moves
- No ledger entries are created
- No outbox event is emitted
- The caller receives an error

### Cache Consistency

Redis is invalidated **after** the database transaction commits:
```
1. DB transaction commits (source of truth updated)
2. Redis cache invalidated (DEL wallet:balance:{id})
3. Next read will populate cache from DB
```

A Redis failure during invalidation (step 2) means a stale cache entry. The TTL (default 5 minutes) bounds the staleness window. Redis is **never** the source of truth.

---

## 16. Known Limitations & Future Improvements

### Current Limitations

| Area | Limitation |
|---|---|
| **Idempotency cleanup** | Expired idempotency records are not automatically purged (no cleanup job) |
| **Notification consumer idempotency** | In-memory Set for processed events; lost on restart. Should be backed by Redis or DB |
| **Multi-currency** | Currency stored per wallet but no FX conversion logic |
| **Kafka in tests** | Kafka is not spun up in unit tests — integration tests require Docker |
| **Metrics** | No Prometheus/OpenTelemetry instrumentation |
| **Rate limiting** | No per-user rate limiting on financial operations |
| **Audit log** | No explicit audit log beyond ledger entries (no `who changed what when`) |
| **Wallet suspension** | No admin endpoint to suspend/close wallets |
| **Real payment gateway** | Deposits are simulated — no Stripe/Razorpay integration |

### Future Improvements

- [ ] Add Prometheus metrics and Grafana dashboards
- [ ] Implement PgBoss or a dedicated outbox worker for production outbox processing
- [ ] Replace in-memory consumer idempotency with Redis sorted sets
- [ ] Add scheduled job to clean up expired idempotency records
- [ ] Add multi-currency support with exchange rate integration
- [ ] Implement admin wallet management endpoints
- [ ] Add OpenTelemetry distributed tracing
- [ ] Implement refresh token rotation
- [ ] Add WebSocket subscriptions for real-time balance updates
- [ ] Add KYC/AML hooks for regulatory compliance
- [ ] Integration test suite using testcontainers
