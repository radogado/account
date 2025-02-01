import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const dynamoClient = new DynamoDBClient({ region: "us-east-1" });
const cognitoClient = new CognitoIdentityProviderClient({
  region: "us-east-1",
});

const USER_POOL_ID = "us-east-1_XXXXXXX"; // Replace with your User Pool ID
const MAX_USERS = 10; // Set maximum number of users

export const handler = async (event) => {
  const { email, password } = JSON.parse(event.body);

  // Check the current user count
  const getParams = {
    TableName: "UserCount",
    Key: { id: { S: "1" } },
  };

  try {
    const data = await dynamoClient.send(new GetItemCommand(getParams));
    const userCount = data.Item?.count?.N ? parseInt(data.Item.count.N, 10) : 0;

    if (userCount >= MAX_USERS) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: "Registration limit reached. No more users can be added.",
        }),
      };
    }

    // Register the user in Cognito
    const cognitoParams = {
      UserPoolId: USER_POOL_ID,
      Username: email,
      TemporaryPassword: password,
      UserAttributes: [{ Name: "email", Value: email }],
    };
    await cognitoClient.send(new AdminCreateUserCommand(cognitoParams));

    // Increment the user count
    const updateParams = {
      TableName: "UserCount",
      Key: { id: { S: "1" } },
      UpdateExpression: "SET count = count + :inc",
      ExpressionAttributeValues: { ":inc": { N: "1" } },
      ReturnValues: "UPDATED_NEW",
    };
    await dynamoClient.send(new UpdateItemCommand(updateParams));

    return {
      statusCode: 201,
      body: JSON.stringify({ message: "User registered successfully." }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
