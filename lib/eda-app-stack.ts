import * as cdk from 'aws-cdk-lib';
import * as lambdanode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as events from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { SES_REGION, SES_EMAIL_FROM, SES_EMAIL_TO } from '../env'; 

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket
    const imagesBucket = new s3.Bucket(this, 'ImagesBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // DynamoDB Table
    const imageTable = new dynamodb.Table(this, 'ImageTable', {
      partitionKey: { name: 'image_name', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_IMAGE, // Enable DynamoDB streams
    });

    // SNS Topic
    const imageTopic = new sns.Topic(this, 'ImageTopic');

    // Dead Letter Queue (DLQ)
    const dlq = new sqs.Queue(this, 'DLQ', {
      retentionPeriod: cdk.Duration.days(14),
    });

    // SQS Queue
    const queue = new sqs.Queue(this, 'ImageQueue', {
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // Allow SNS to send messages to SQS
    queue.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('sns.amazonaws.com')],
        actions: ['sqs:SendMessage'],
        resources: [queue.queueArn],
        conditions: {
          ArnEquals: { 'aws:SourceArn': imageTopic.topicArn },
        },
      })
    );

    // Log Image Lambda
    const logImageFn = new lambdanode.NodejsFunction(this, 'LogImageFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/logImage.ts`,
      environment: {
        TABLE_NAME: imageTable.tableName,
      },
      timeout: cdk.Duration.seconds(15),
    });

    // Grant permissions
    imageTable.grantWriteData(logImageFn);
    imagesBucket.grantRead(logImageFn);

    // Process Image Lambda (handles both ObjectCreated and ObjectRemoved)
    const processImageFn = new lambdanode.NodejsFunction(this, 'ProcessImageFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      environment: {
        TABLE_NAME: imageTable.tableName,
      },
      timeout: cdk.Duration.seconds(15),
    });

    // Grant permissions to Process Image Lambda
    imageTable.grantWriteData(processImageFn);
    imagesBucket.grantRead(processImageFn);

    // Rejection Mailer Lambda
    const rejectionMailerFn = new lambdanode.NodejsFunction(this, 'RejectionMailerFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
      environment: {
        SES_EMAIL_FROM,
        SES_EMAIL_TO,
        SES_REGION,
      },
      timeout: cdk.Duration.seconds(15),
    });

    // Confirmation Mailer Lambda
    const confirmationMailerFn = new lambdanode.NodejsFunction(this, 'ConfirmationMailerFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
      environment: {
        SES_EMAIL_FROM,
        SES_EMAIL_TO,
        SES_REGION,
      },
      timeout: cdk.Duration.seconds(15),
    });

    // Update Table Lambda
    const updateTableFn = new lambdanode.NodejsFunction(this, 'UpdateTableFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/updateTable.ts`,
      environment: {
        TABLE_NAME: imageTable.tableName,
      },
      timeout: cdk.Duration.seconds(15),
    });

    // Grant permissions to Update Table Lambda
    imageTable.grantWriteData(updateTableFn);

    // SNS Subscriptions

    // Log Image Lambda subscribes via SQS (for image upload events)
    imageTopic.addSubscription(
      new subs.SqsSubscription(queue)
    );

    // Process Image Lambda subscribes to SNS (ObjectRemoved events)
    imageTopic.addSubscription(
      new subs.LambdaSubscription(processImageFn, {
        filterPolicy: {
          eventType: sns.SubscriptionFilter.stringFilter({
            allowlist: ['ObjectRemoved'], // Filter for delete events
          }),
        },
      })
    );

    // Update Table Lambda (for metadata updates)
    imageTopic.addSubscription(
      new subs.LambdaSubscription(updateTableFn, {
        filterPolicy: {
          metadata_type: sns.SubscriptionFilter.stringFilter({
            allowlist: ['Caption', 'Date', 'Photographer'],
          }),
        },
      })
    );

    // S3 Event Notifications to SNS
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(imageTopic)
    );
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_REMOVED,
      new s3n.SnsDestination(imageTopic)
    );

    // Add DynamoDB Stream to Confirmation Mailer Lambda
    confirmationMailerFn.addEventSource(
      new events.DynamoEventSource(imageTable, {
        startingPosition: lambda.StartingPosition.LATEST,
      })
    );

    // Add SQS event source to Log Image Lambda
    logImageFn.addEventSource(new events.SqsEventSource(queue, { batchSize: 5 }));

    // Rejection Mailer listens to DLQ
    rejectionMailerFn.addEventSource(new events.SqsEventSource(dlq));

    // Grant SES SendEmail permission to Lambda functions
    const sesPolicy = new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    });

    confirmationMailerFn.addToRolePolicy(sesPolicy);
    rejectionMailerFn.addToRolePolicy(sesPolicy);

    // Outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: imagesBucket.bucketName,
      description: 'The name of the S3 bucket for image uploads.',
    });

    new cdk.CfnOutput(this, 'ImageTableName', {
      value: imageTable.tableName,
      description: 'The name of the DynamoDB table for image metadata.',
    });

    new cdk.CfnOutput(this, 'ImageTopicARN', {
      value: imageTopic.topicArn,
      description: 'The ARN of the SNS topic for image events.',
    });

    new cdk.CfnOutput(this, 'QueueURL', {
      value: queue.queueUrl,
      description: 'The URL of the main SQS queue.',
    });

    new cdk.CfnOutput(this, 'DLQURL', {
      value: dlq.queueUrl,
      description: 'The URL of the Dead Letter Queue (DLQ).',
    });
  }
}
