import { SNSEvent } from 'aws-lambda';
import { DynamoDB } from 'aws-sdk';

const dynamoDb = new DynamoDB.DocumentClient();
const tableName = process.env.TABLE_NAME || '';

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
    } catch (error) {
      console.error(`Failed to update metadata for ${id}:`, error);
    }
  }
};
