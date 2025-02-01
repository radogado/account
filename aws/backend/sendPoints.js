import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

export const handler = async (event) => {
  const { points } = JSON.parse(event.body);
  const userId = event.requestContext.authorizer.principalId;

  const params = {
    TableName: "Users",
    Key: { userId: { S: userId } },
    UpdateExpression: "SET pointsBalance = pointsBalance - :points",
    ConditionExpression: "pointsBalance >= :points",
    ExpressionAttributeValues: {
      ":points": { N: String(points) },
    },
    ReturnValues: "ALL_NEW",
  };

  try {
    const data = await client.send(new UpdateItemCommand(params));
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Points sent successfully!",
        balance: data.Attributes.pointsBalance.N,
      }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
