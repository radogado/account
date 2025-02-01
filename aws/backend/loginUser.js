import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({ region: "us-east-1" });

export const handler = async (event) => {
  const { email, password } = JSON.parse(event.body);

  const params = {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: "XXXXXXXXXXXXXXXXXXXXXX", // Replace with your Cognito App Client ID
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  };

  try {
    const data = await client.send(new InitiateAuthCommand(params));
    return {
      statusCode: 200,
      body: JSON.stringify({ token: data.AuthenticationResult.IdToken }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
