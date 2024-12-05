import { SQSHandler } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const sesClient = new SESClient({ region: process.env.SES_REGION });

export const handler: SQSHandler = async (event) => {
  console.log("Processing DLQ events:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      // Parse SQS message body to get SNS message
      const snsMessage = JSON.parse(record.body);
      console.log("Parsed SNS Message:", snsMessage);

      // Parse S3 event data from SNS message
      const s3Event = JSON.parse(snsMessage.Message);
      console.log("Parsed S3 Event:", s3Event);

      // Extract file name from S3 event
      const fileName = s3Event.Records[0].s3.object.key;
      console.log(`File Name: ${fileName}`);

      // Set up email parameters
      const params = {
        Destination: { ToAddresses: [process.env.SES_EMAIL_TO!] },
        Message: {
          Body: { Text: { Data: `File upload rejected: ${fileName}` } },
          Subject: { Data: "File Upload Rejected" },
        },
        Source: process.env.SES_EMAIL_FROM!,
      };

      // Send email using SES
      await sesClient.send(new SendEmailCommand(params));
      console.log(`Rejection email sent for ${fileName}`);
    } catch (error) {
      console.error("Error processing record:", error);
    }
  }
};
