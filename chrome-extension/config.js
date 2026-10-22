// Set this to the HTTPS URL of the deployed TextAI API before packaging the extension.
// Local development: "http://localhost:8787"
// Production example: "https://textai-api.yourdomain.com"
// Never put GROQ_API_KEY or any other provider secret in this extension folder.
self.TEXTAI_CONFIG = Object.freeze({
  apiBaseUrl: "https://your-textai-api.example.com",
});
