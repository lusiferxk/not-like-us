/**
 * src/config/sqs.js
 * AWS SQS v3 client — singleton.
 * Exports pre-resolved queue URL constants alongside the client.
 */
import { SQSClient } from '@aws-sdk/client-sqs';
import 'dotenv/config';

export const sqsClient = new SQSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    // credentials: {
    //     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    //     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    // },
});

// Centralized queue URL references — avoids string duplication across workers
export const QUEUE_URLS = Object.freeze({
    ORDER_PROCESSING: process.env.SQS_ORDER_PROCESSING_QUEUE_URL,
    PAYMENT_SUCCESS: process.env.SQS_PAYMENT_SUCCESS_QUEUE_URL,
    EMAIL_NOTIFICATION: process.env.SQS_EMAIL_NOTIFICATION_QUEUE_URL,
});

export default sqsClient;
