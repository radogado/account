const apiUrl = "https://bi4l9ty4wh.execute-api.us-east-1.amazonaws.com"; // Replace with your API Gateway URL

// Initialize AWS Cognito
const poolData = {
  UserPoolId: "us-east-1_mbySN2btL", // Replace with your User Pool ID
  ClientId: "7oqjkjq50p78fnok123eed3sto", // Replace with your App Client ID
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
// Login form handler
document.getElementById("login-form").onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;

  const authenticationData = { Username: email, Password: password };
  const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails(
    authenticationData
  );
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
      document.getElementById(
        "balance"
      ).textContent = `Points: ${data.balance}`;
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
