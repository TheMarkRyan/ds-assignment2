import { SQSHandler } from "aws-lambda";
import { DynamoDB } from "aws-sdk";

const dynamoDb = new DynamoDB.DocumentClient();
const tableName = process.env.TABLE_NAME || "";

export const handler: SQSHandler = async (event) => {
  console.log("SQS Event Received:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      // Parse the SNS message from the SQS message body
      const snsMessage = JSON.parse(record.body);
      console.log("Parsed SNS Message:", JSON.stringify(snsMessage, null, 2));

      // Parse the S3 event from the SNS message
      const s3Event = JSON.parse(snsMessage.Message);
      console.log("Parsed S3 Event:", JSON.stringify(s3Event, null, 2));

      const s3Records = s3Event.Records || [];
      for (const s3Record of s3Records) {
        const bucketName = s3Record.s3.bucket.name;
        const objectKey = decodeURIComponent(
          s3Record.s3.object.key.replace(/\+/g, " ")
        );
        const fileType = objectKey.split('.').pop()?.toLowerCase();

        console.log(`Processing file: ${objectKey} of type: ${fileType}`);

        if (!fileType || (fileType !== "jpeg" && fileType !== "png")) {
          console.error(`Unsupported file type: ${fileType}`);
          continue;
        }

        try {
          await dynamoDb
            .put({
              TableName: tableName,
              Item: { image_name: objectKey },
            })
            .promise();
          console.log(`Successfully logged ${objectKey} to DynamoDB`);
        } catch (dbError) {
          console.error(`DynamoDB Write Error for ${objectKey}:`, dbError);
        }
      }
    } catch (err) {
      console.error("Error Processing SQS Message:", err);
    }
  }
};
