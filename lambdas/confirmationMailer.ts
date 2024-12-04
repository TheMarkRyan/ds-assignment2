import { SQSHandler } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const sesClient = new SESClient({ region: process.env.SES_REGION });

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const message = JSON.parse(record.body); // Parses the SQS message body
    const fileName = message.Records[0].s3.object.key; // Extracts the S3 object key

    const params = {
      Destination: { ToAddresses: [process.env.SES_EMAIL_TO!] }, // Sends to recipient
      Message: {
        Body: { Text: { Data: `Your image upload (${fileName}) was successful.` } }, // Email body
        Subject: { Data: "Image Upload Confirmation" }, // Email subject
      },
      Source: process.env.SES_EMAIL_FROM!, // Sender's address
    };

    try {
      await sesClient.send(new SendEmailCommand(params)); // Sends email
      console.log(`Confirmation email sent for ${fileName}`);
    } catch (error) {
      console.error("Failed to send confirmation email:", error);
    }
  }
};
