/**
 * src/config/eventbridge.js
 * AWS EventBridge Scheduler client — singleton.
 * Used by the cron setup utility to register/manage scheduled rules.
 */
import { SchedulerClient } from '@aws-sdk/client-scheduler';
import 'dotenv/config';

export const schedulerClient = new SchedulerClient({
  region: process.env.AWS_REGION || 'us-east-1',
  // credentials: {
  //   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  // },
});

/**
 * Shared scheduler configuration used when creating/updating schedules.
 */
export const SCHEDULER_CONFIG = Object.freeze({
  // IAM Role that EventBridge Scheduler assumes to invoke targets
  schedulerRoleArn: process.env.EVENTBRIDGE_SCHEDULER_ROLE_ARN,
  // ARN of the Lambda function (or SQS queue) acting as the cron target
  cronTargetArn: process.env.EVENTBRIDGE_CRON_TARGET_ARN,
});

export default schedulerClient;
