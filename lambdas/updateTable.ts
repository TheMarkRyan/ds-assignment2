import { SNSEvent } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const dynamoDb = new DynamoDB.DocumentClient();
const sesClient = new SESClient({ region: process.env.SES_REGION });
const tableName = process.env.TABLE_NAME || '';
const emailFrom = process.env.SES_EMAIL_FROM!;
const emailTo = process.env.SES_EMAIL_TO!;

export const handler = async (event: SNSEvent) => {
  console.log('Received SNS event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    const snsMessage = JSON.parse(record.Sns.Message);
    const metadataType = record.Sns.MessageAttributes.metadata_type?.Value;

    if (!metadataType) {
      console.error('Missing metadata_type attribute');
      continue;
    }

    const { id, value } = snsMessage;

    if (!id || !value) {
      console.error('Invalid message format');
      continue;
    }

    // Validate metadata_type
    if (!['Caption', 'Date', 'Photographer'].includes(metadataType)) {
      console.error(`Invalid metadata_type: ${metadataType}`);
      continue;
    }

    try {
      // Update metadata in DynamoDB
      await dynamoDb
        .update({
          TableName: tableName,
          Key: { image_name: id },
          UpdateExpression: 'SET #attr = :value',
          ExpressionAttributeNames: {
            '#attr': metadataType,
          },
          ExpressionAttributeValues: {
            ':value': value,
          },
        })
        .promise();

      console.log(`Updated ${metadataType} for ${id} to "${value}"`);

      // Send email for metadata update
      const emailParams = {
        Destination: { ToAddresses: [emailTo] },
        Message: {
          Body: {
            Text: {
              Data: `Metadata "${metadataType}" with value "${value}" has been successfully added to image: ${id}.`,
            },
          },
          Subject: { Data: 'Metadata Update Confirmation' },
        },
        Source: emailFrom,
      };

      try {
        await sesClient.send(new SendEmailCommand(emailParams));
        console.log(`Metadata update email sent for ${id}`);
      } catch (emailError) {
        console.error('Error sending metadata update email:', emailError);
      }
    } catch (dbError) {
      console.error(`Failed to update metadata for ${id}:`, dbError);
    }
  }
};
