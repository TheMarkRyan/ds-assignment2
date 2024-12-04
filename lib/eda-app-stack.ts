import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import { Construct } from "constructs";

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket
    const imagesBucket = new s3.Bucket(this, "ImagesBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // DynamoDB Table
    const imageTable = new dynamodb.Table(this, "ImageTable", {
      partitionKey: { name: "image_name", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // SNS Topic
    const imageTopic = new sns.Topic(this, "ImageTopic");

    // SQS Queue
    const queue = new sqs.Queue(this, "ImageQueue", {
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    // Allow SNS to send messages to SQS
    queue.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        principals: [new cdk.aws_iam.ServicePrincipal("sns.amazonaws.com")],
        actions: ["sqs:SendMessage"],
        resources: [queue.queueArn],
        conditions: {
          ArnEquals: { "aws:SourceArn": imageTopic.topicArn },
        },
      })
    );

    // Log Image Lambda
    const logImageFn = new lambdanode.NodejsFunction(this, "LogImageFn", {
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

    // SNS Subscription for SQS
    imageTopic.addSubscription(new subs.SqsSubscription(queue));

    // S3 Event Notification to SNS
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(imageTopic)
    );

    // SQS Event Source for Lambda
    logImageFn.addEventSource(new events.SqsEventSource(queue));

    // Outputs
    new cdk.CfnOutput(this, "BucketName", {
      value: imagesBucket.bucketName,
      description: "The name of the S3 bucket for image uploads.",
    });

    new cdk.CfnOutput(this, "ImageTableName", {
      value: imageTable.tableName,
      description: "The name of the DynamoDB table for image metadata.",
    });

    new cdk.CfnOutput(this, "ImageTopicARN", {
      value: imageTopic.topicArn,
      description: "The ARN of the SNS topic for image events.",
    });

    new cdk.CfnOutput(this, "QueueURL", {
      value: queue.queueUrl,
      description: "The URL of the SQS queue.",
    });
  }
}
