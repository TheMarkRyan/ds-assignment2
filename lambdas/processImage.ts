import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { SNSEvent } from "aws-lambda";

// Initialize DynamoDB Client
const dynamoDb = new DynamoDBClient({});

export const handler = async (event: SNSEvent) => {
  console.log("Received SNS event:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      // Parse SNS message
      const snsMessage = JSON.parse(record.Sns.Message);
      console.log("Parsed SNS Message:", JSON.stringify(snsMessage, null, 2));

      if (snsMessage.Records) {
        for (const s3Event of snsMessage.Records) {
          const srcBucket = s3Event.s3.bucket.name;
          const srcKey = decodeURIComponent(
            s3Event.s3.object.key.replace(/\+/g, " ")
          );

          // Identify event type
          const eventType = s3Event.eventName; // e.g., "ObjectCreated:Put", "ObjectRemoved:Delete"
          console.log(`Processing event type: ${eventType} for ${srcKey}`);

          if (eventType.startsWith("ObjectRemoved")) {
            console.log(`Deleting item from DynamoDB for removed object: ${srcKey}`);
            const deleteParams = {
              TableName: process.env.TABLE_NAME!,
              Key: {
                image_name: { S: srcKey },
              },
            };

            try {
              await dynamoDb.send(new DeleteItemCommand(deleteParams));
              console.log(`Successfully deleted item ${srcKey} from DynamoDB`);
            } catch (error) {
              console.error(`Error deleting item ${srcKey} from DynamoDB:`, error);
            }
          } else {
            console.log(`Event type not relevant for processing: ${eventType}`);
          }
        }
      } else {
        console.log("No S3 records found in SNS message");
      }
    } catch (error) {
      console.error("Error processing SNS record:", error);
    }
  }
};
