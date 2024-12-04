import { SQSHandler } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const sesClient = new SESClient({ region: process.env.SES_REGION });

export const handler: SQSHandler = async (event) => {
  console.log("Processing DLQ events:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const message = JSON.parse(record.body);
    const fileName = message.Records[0].s3.object.key;

    const params = {
      Destination: { ToAddresses: [process.env.SES_EMAIL_TO!] },
      Message: {
        Body: { Text: { Data: `File upload rejected: ${fileName}` } },
        Subject: { Data: "File Upload Rejected" },
      },
      Source: process.env.SES_EMAIL_FROM!,
    };

    try {
      await sesClient.send(new SendEmailCommand(params));
      console.log(`Rejection email sent for ${fileName}`);
    } catch (error) {
      console.error("Failed to send rejection email:", error);
    }
  }
};
