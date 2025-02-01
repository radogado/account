/frontend
  ├── index.html
  ├── script.js
  ├── style.css

/backend
  ├── registerUser.js
  ├── loginUser.js
  ├── checkBalance.js
  ├── sendPoints.js
  ├── dynamoDbHelper.js
  
  
  –––
  
  If you’re concerned about the size of the AWS SDK for JavaScript (aws-sdk), you can use the modular and lightweight AWS SDK v3 for JavaScript. AWS SDK v3 is fully modular, so you can import only the specific services you need, significantly reducing bundle size.
  
  Benefits of AWS SDK v3:
	  1.	Modular Packages: You import only the services and utilities you need.
	  2.	Tree-Shakable: Unused code can be excluded during bundling.
	  3.	Smaller Bundle Size: Reduces the frontend payload compared to aws-sdk v2.
  
  Example: Minimal AWS SDK v3 Implementation
  
  Here’s how to rewrite the backend functions with AWS SDK v3:
  
  Install the Required Packages
  
  npm install @aws-sdk/client-dynamodb @aws-sdk/client-cognito-identity-provider
  
  Backend Lambda Functions with AWS SDK v3
	  1.	registerUser.js
  
  import { CognitoIdentityProviderClient, AdminCreateUserCommand } from "@aws-sdk/client-cognito-identity-provider";
  
  const client = new CognitoIdentityProviderClient({ region: "us-east-1" });
  
  export const handler = async (event) => {
	  const { email, password } = JSON.parse(event.body);
	  const params = {
		  UserPoolId: "us-east-1_XXXXXXX", // Replace with your User Pool ID
		  Username: email,
		  TemporaryPassword: password,
		  UserAttributes: [{ Name: "email", Value: email }],
	  };
  
	  try {
		  await client.send(new AdminCreateUserCommand(params));
		  return {
			  statusCode: 201,
			  body: JSON.stringify({ message: "User created successfully" }),
		  };
	  } catch (error) {
		  return {
			  statusCode: 400,
			  body: JSON.stringify({ error: error.message }),
		  };
	  }
  };
  
	  2.	checkBalance.js
  
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
  
	  3.	sendPoints.js
  
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
			  body: JSON.stringify({ message: "Points sent successfully!", balance: data.Attributes.pointsBalance.N }),
		  };
	  } catch (error) {
		  return {
			  statusCode: 400,
			  body: JSON.stringify({ error: error.message }),
		  };
	  }
  };
  
  Frontend: Use Minimal Fetch Calls
  
  Instead of including the AWS SDK on the frontend, you can use AWS Amplify (minimal configuration) or directly interact with your backend API using fetch.
  
  For example:
  
  const apiUrl = "https://<API_GATEWAY_URL>";
  
  async function checkBalance() {
	  const token = localStorage.getItem("token");
  
	  const response = await fetch(`${apiUrl}/check-balance`, {
		  method: "GET",
		  headers: {
			  Authorization: `Bearer ${token}`,
		  },
	  });
  
	  if (response.ok) {
		  const data = await response.json();
		  console.log("Balance:", data.balance);
	  } else {
		  console.error("Failed to fetch balance:", await response.text());
	  }
  }
  
  Advantages of This Approach:
	  1.	No AWS SDK on Frontend: Frontend communicates only with API Gateway.
	  2.	Smaller Backend Packages: AWS SDK v3 imports only specific modules.
	  3.	Modular Design: You can easily add/remove functionalities without impacting other services.
  
  This setup ensures your app remains lightweight and secure while leveraging AWS services effectively.
  
  Here’s the loginUser.js script using AWS SDK v3, and the full script.js for the frontend functionality.
  
  Backend: loginUser.js (Using AWS SDK v3)
  
  import { CognitoIdentityProviderClient, InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
  
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
  
  Frontend: Full script.js
  
  This script interacts with the backend API (Cognito-backed authentication and API Gateway endpoints).
  
  script.js
  
  const apiUrl = "https://<API_GATEWAY_URL>"; // Replace with your API Gateway URL
  
  // Initialize AWS Cognito
  const poolData = {
	  UserPoolId: "us-east-1_XXXXXXX", // Replace with your User Pool ID
	  ClientId: "XXXXXXXXXXXXXXXXXXXXXX", // Replace with your App Client ID
  };
  const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
  
  // Helper: Show/Hide containers
  function showContainer(containerId) {
	  document.getElementById("auth-container").style.display = "none";
	  document.getElementById("user-container").style.display = "none";
	  document.getElementById(containerId).style.display = "block";
  }
  
  // Registration form handler
  document.getElementById("register-form").onsubmit = async (e) => {
	  e.preventDefault();
	  const email = document.getElementById("email").value;
	  const password = document.getElementById("password").value;
  
	  const attributeList = [
		  new AmazonCognitoIdentity.CognitoUserAttribute({ Name: "email", Value: email }),
	  ];
  
	  userPool.signUp(email, password, attributeList, null, (err, result) => {
		  if (err) {
			  alert(err.message || JSON.stringify(err));
			  return;
		  }
		  alert("Registration successful! Please log in.");
	  });
  };
  
  // Login form handler
  document.getElementById("login-form").onsubmit = async (e) => {
	  e.preventDefault();
	  const email = document.getElementById("login-email").value;
	  const password = document.getElementById("login-password").value;
  
	  const authenticationData = { Username: email, Password: password };
	  const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails(authenticationData);
	  const cognitoUser = new AmazonCognitoIdentity.CognitoUser({
		  Username: email,
		  Pool: userPool,
	  });
  
	  cognitoUser.authenticateUser(authenticationDetails, {
		  onSuccess: (result) => {
			  alert("Login successful!");
			  localStorage.setItem("token", result.getIdToken().getJwtToken());
			  showContainer("user-container");
			  document.getElementById("username").textContent = email;
		  },
		  onFailure: (err) => {
			  alert(err.message || JSON.stringify(err));
		  },
	  });
  };
  
  // Check balance handler
  document.getElementById("check-balance").onclick = async () => {
	  const token = localStorage.getItem("token");
  
	  try {
		  const response = await fetch(`${apiUrl}/check-balance`, {
			  method: "GET",
			  headers: {
				  Authorization: `Bearer ${token}`,
			  },
		  });
  
		  if (response.ok) {
			  const data = await response.json();
			  document.getElementById("balance").textContent = `Points: ${data.balance}`;
		  } else {
			  throw new Error(await response.text());
		  }
	  } catch (error) {
		  console.error("Error fetching balance:", error);
		  alert("Failed to fetch balance.");
	  }
  };
  
  // Send points handler
  document.getElementById("send-points").onclick = async () => {
	  const token = localStorage.getItem("token");
	  const points = prompt("Enter points to send:");
  
	  if (!points || isNaN(points)) {
		  alert("Invalid input.");
		  return;
	  }
  
	  try {
		  const response = await fetch(`${apiUrl}/send-points`, {
			  method: "POST",
			  headers: {
				  Authorization: `Bearer ${token}`,
				  "Content-Type": "application/json",
			  },
			  body: JSON.stringify({ points: Number(points) }),
		  });
  
		  if (response.ok) {
			  alert("Points sent successfully!");
			  await document.getElementById("check-balance").click();
		  } else {
			  throw new Error(await response.text());
		  }
	  } catch (error) {
		  console.error("Error sending points:", error);
		  alert("Failed to send points.");
	  }
  };
  
  // Auto-login if token exists
  window.onload = () => {
	  const token = localStorage.getItem("token");
	  if (token) {
		  showContainer("user-container");
	  } else {
		  showContainer("auth-container");
	  }
  };
  
  How It Works:
	  1.	Registration: Uses AWS Cognito directly for user registration.
	  2.	Login: Retrieves and stores the JWT token in localStorage.
	  3.	Check Balance: Sends a GET request to /check-balance with the token for authentication.
	  4.	Send Points: Sends a POST request to /send-points with the token and payload.
  
  Advantages:
	  •	Minimal Frontend Code: The frontend communicates only with your API Gateway and uses Cognito JS SDK for authentication.
	  •	JWT Token Authentication: Securely manages authentication using tokens stored in localStorage.
	  •	AWS SDK v3 on Backend: Lightweight backend implementation with modular imports.
  
  This setup ensures a lightweight frontend and backend optimized for scalability and security.
  
  –––
  
  To limit registration to 10 users, you can track the number of registered users using a database or directly with AWS services like DynamoDB. Here’s how you can implement this limitation.
  
  Backend: registerUser.js with Registration Limit
  
  In this example, we’ll use DynamoDB to store and track the count of registered users. We’ll check the count before allowing new registrations.
  
  Steps:
	  1.	Create a DynamoDB table named UserCount with a primary key id (set it to a fixed value like 1).
	  2.	Store the count of registered users in this table.
	  3.	Check the count before registering a new user.
  
  Updated registerUser.js:
  
  import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
  import { CognitoIdentityProviderClient, AdminCreateUserCommand } from "@aws-sdk/client-cognito-identity-provider";
  
  const dynamoClient = new DynamoDBClient({ region: "us-east-1" });
  const cognitoClient = new CognitoIdentityProviderClient({ region: "us-east-1" });
  
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
				  body: JSON.stringify({ error: "Registration limit reached. No more users can be added." }),
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
  
  Setting Up the DynamoDB Table
	  1.	Table Name: UserCount
	  2.	Primary Key: id (String)
	  3.	Initial Data:
	  •	id: "1"
	  •	count: 0
  
  You can add the initial data manually using the AWS Management Console or through a script.
  
  Behavior
	  1.	When the user registers:
	  •	The Lambda function checks the UserCount table.
	  •	If the count is less than 10, the user is registered, and the count is incremented.
	  •	If the count is 10 or more, registration is denied with a 403 error.
	  2.	Concurrency Management:
  DynamoDB’s atomic UpdateExpression ensures that the user count is updated safely, even if multiple users try to register at the same time.
  
  Frontend Behavior
  
  When a user tries to register after the limit is reached, they will see an error message like:
  
	  “Registration limit reached. No more users can be added.”
  
  No changes are needed in the frontend code; it will display the error returned by the backend.
  
  This implementation ensures the registration process respects the limit and provides a scalable solution.