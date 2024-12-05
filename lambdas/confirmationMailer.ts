import { DynamoDBStreamHandler } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const sesClient = new SESClient({ region: process.env.SES_REGION });

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    if (record.eventName === "INSERT") {
      const newItem = record.dynamodb?.NewImage;
      const fileName = newItem?.image_name?.S;

      const params = {
        Destination: { ToAddresses: [process.env.SES_EMAIL_TO!] },
        Message: {
          Body: { Text: { Data: `Image ${fileName} was successfully added.` } },
          Subject: { Data: "Image Upload Confirmation" },
        },
        Source: process.env.SES_EMAIL_FROM!,
      };

      try {
        await sesClient.send(new SendEmailCommand(params));
        console.log(`Confirmation email sent for ${fileName}`);
      } catch (error) {
        console.error("Error sending confirmation email:", error);
      }
    }
  }
};
