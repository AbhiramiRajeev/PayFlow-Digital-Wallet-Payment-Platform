/**
 * Kafka topic constants for PayFlow events.
 * All topics use kebab-case for consistency with Kafka naming conventions.
 */
export const KafkaTopics = {
  PAYMENT_INITIATED: 'payment.initiated',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  TRANSFER_COMPLETED: 'transfer.completed',
  TRANSFER_REVERSED: 'transfer.reversed',
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];

/** Base structure for all PayFlow Kafka events. */
export interface PayFlowEvent {
  eventId: string;
  eventType: string;
  occurredAt: string; // ISO-8601
  version: number;
}

export interface PaymentInitiatedEvent extends PayFlowEvent {
  eventType: 'payment.initiated';
  payload: {
    paymentId: string;
    walletId: string;
    amount: string; // serialized BigInt as string
    currency: string;
    type: string;
  };
}

export interface PaymentCompletedEvent extends PayFlowEvent {
  eventType: 'payment.completed';
  payload: {
    paymentId: string;
    walletId: string;
    amount: string;
    currency: string;
  };
}

export interface PaymentFailedEvent extends PayFlowEvent {
  eventType: 'payment.failed';
  payload: {
    paymentId: string;
    reason: string;
  };
}

export interface TransferCompletedEvent extends PayFlowEvent {
  eventType: 'transfer.completed';
  payload: {
    transferId: string;
    senderWalletId: string;
    receiverWalletId: string;
    amount: string;
    currency: string;
  };
}

export interface TransferReversedEvent extends PayFlowEvent {
  eventType: 'transfer.reversed';
  payload: {
    originalTransferId: string;
    reversalTransferId: string;
    senderWalletId: string;
    receiverWalletId: string;
    amount: string;
    currency: string;
  };
}
