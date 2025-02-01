import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

export const handler = async (event) => {
  const userId = event.requestContext.authorizer.principalId;

  const params = {
    TableName: "Users",
    Key: { userId: { S: userId } },
  };

  try {
    const data = await client.send(new GetItemCommand(params));
    const balance = data.Item?.pointsBalance?.N || 0;

    return {
      statusCode: 200,
      body: JSON.stringify({ balance: parseInt(balance, 10) }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unable to fetch balance" }),
    };
  }
};
