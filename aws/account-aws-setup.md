Here’s an updated step-by-step guide to set up and manage your AWS-backed HTML App with User Registration, Login, and Points Management, now including a registration limit and user editing capabilities.

1. Set Up Cognito User Pool

Step 1.1: Create the User Pool
	1.	Go to the Amazon Cognito service in the AWS Console.
	2.	Click Create a User Pool.
	3.	Configure:
	•	Sign-in Options: Choose email as the sign-in option.
	•	Password Policy: Set a password policy (e.g., minimum length, special characters).
	•	Attributes: Add standard and custom attributes if needed (e.g., email, custom:points).
	4.	App Clients:
	•	Create an App Client (disable “Generate client secret” for frontend usage).
	•	Copy the App Client ID for later use.
	5.	Click Create Pool and note:
	•	User Pool ID
	•	App Client ID

2. Set Up DynamoDB Table to Track User Count
	1.	Navigate to DynamoDB in the AWS Console.
	2.	Create a new table:
	•	Table Name: UserCount
	•	Partition Key: id (String)
	3.	Add an initial item:
	•	id: 1
	•	count: 0
	4.	The table will store and track the number of registered users.

3. Set Up Lambda Functions

Step 3.1: Create Lambda Functions

You need Lambda functions for:
	1.	Registering Users with Limits.
	2.	Authenticating Users.
	3.	Checking/Updating Points.

Use the AWS Lambda service:
	1.	Create a new function for each feature.
	2.	Use Node.js or Python runtimes and provide the code snippets:
	•	Register User with Limit
	•	Login User

Step 3.2: Attach IAM Roles

Assign each Lambda function an IAM role with the following policies:
	1.	DynamoDB Full Access (for UserCount table).
	2.	Cognito User Pools Full Access (to manage users).

4. Set Up API Gateway
	1.	Go to API Gateway in the AWS Console.
	2.	Create a REST API or HTTP API (simpler for this use case).
	3.	Define endpoints:
	•	POST /register → Invoke the Register User Lambda.
	•	POST /login → Invoke the Login User Lambda.
	•	GET /check-balance → Fetch user points from Cognito.
	•	POST /send-points → Update points in Cognito.
	4.	Enable Authorization:
	•	Attach a Cognito Authorizer to protect endpoints.
	•	Configure the authorizer with your Cognito User Pool.
	5.	Deploy the API and note the API URL.

5. Update Frontend

Step 5.1: Update script.js

Update the frontend JavaScript to include API calls and manage token storage. Reference the latest API Gateway URL and Cognito User Pool settings.

Updated Registration with Limit:

Handle the registration limit in the frontend:

document.getElementById("register-form").onsubmit = async (e) => {
	e.preventDefault();
	const email = document.getElementById("email").value;
	const password = document.getElementById("password").value;

	try {
		const response = await fetch(`${apiUrl}/register`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, password }),
		});

		if (response.status === 201) {
			alert("Registration successful!");
		} else if (response.status === 403) {
			alert("Registration limit reached.");
		} else {
			throw new Error("Registration failed.");
		}
	} catch (error) {
		console.error("Error registering user:", error);
	}
};

Include Cognito JS SDK:

Include the Cognito Identity SDK in your index.html:

<script src="https://cdn.jsdelivr.net/npm/amazon-cognito-identity-js@5.2.4/dist/amazon-cognito-identity.min.js"></script>

6. Test Your App
	1.	Deploy the frontend to an S3 bucket or local server.
	2.	Open the app and register users until the limit is reached.
	3.	Attempt login and test sending/receiving points.

7. Manage Users in AWS

To edit or manage users:
	1.	Go to Amazon Cognito > User Pools > Select your User Pool > Users and Groups.
	2.	Edit attributes, reset passwords, enable/disable users, or delete users directly.

8. Additional Features (Optional)
	1.	Email Notifications:
	•	Use Amazon SES to send email notifications for user registration, password resets, etc.
	2.	CloudWatch Logs:
	•	Enable logging for Lambda functions to debug issues.
	3.	Scaling:
	•	Use AWS Lambda Reserved Concurrency to manage scaling limits.

Final Architecture Overview
	1.	Frontend: Static HTML, JS, and CSS (S3 or local server).
	2.	Authentication: Amazon Cognito User Pool.
	3.	Database: DynamoDB (UserCount table).
	4.	Backend: AWS Lambda with API Gateway.
	5.	Deployment:
	•	Frontend: S3 or CloudFront.
	•	Backend: Deployed Lambda functions and API Gateway endpoints.

This updated setup ensures security, scalability, and adherence to the user registration limit.