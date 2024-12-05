import { SQSHandler } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const sesClient = new SESClient({ region: process.env.SES_REGION });

export const handler: SQSHandler = async (event) => {
  console.log("Received SQS Event:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      // Parse the SNS message from the SQS record body
      console.log("Raw SQS Message Body:", record.body);
      const snsMessage = JSON.parse(record.body);

      if (!snsMessage.Message) {
        console.error("Missing 'Message' in SNS message");
        continue; // Skip this record
      }

      // Parse the S3 event from the SNS message
      const s3Event = JSON.parse(snsMessage.Message);
      console.log("Parsed S3 Event:", s3Event);

      const fileName = s3Event.Records[0]?.s3?.object?.key;
      if (!fileName) {
        console.error("No S3 object key found in the event");
        continue; // Skip this record
      }
      console.log("File Name:", fileName);

      // Email parameters
      const params = {
        Destination: { ToAddresses: [process.env.SES_EMAIL_TO!] },
        Message: {
          Body: {
            Text: {
              Data: `Your image upload (${fileName}) was successful.`,
            },
          },
          Subject: { Data: "Image Upload Confirmation" },
        },
        Source: process.env.SES_EMAIL_FROM!,
      };

      // Send email
      await sesClient.send(new SendEmailCommand(params));
      console.log(`Confirmation email sent for ${fileName}`);
    } catch (error) {
      console.error("Error processing SQS record:", error);
    }
  }
};
