/**
 * index.js
 */

// Import required libraries:
const express = require('express');             // Web framework for handling HTTP requests
const fetch = require('node-fetch');            // For making HTTP requests (used to call Telegram API)
const cors = require('cors');                   // Middleware to enable Cross-Origin Resource Sharing
const fs = require('fs');                       // File system module to check for files
const { Configuration, OpenAIApi } = require('openai');  // OpenAI client for Chat Completion API

// Load environment variables from a .env file if it exists.
// This is useful for local development to store sensitive keys.
if (fs.existsSync('.env')) {
  require('dotenv').config();
}

// Initialize Firebase Admin SDK for Firestore
const admin = require('firebase-admin');
// Check if the service account key exists in the current directory.
if (fs.existsSync('./serviceAccountKey.json')) {
  const serviceAccount = require('./serviceAccountKey.json');
  console.log("Using Firebase project:", serviceAccount.project_id);
  // Initialize the app using the service account credentials.
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else {
  console.error("Service account key not found. Please add serviceAccountKey.json to your project.");
  process.exit(1);
}
// Get a Firestore database instance.
const db = admin.firestore();

// Initialize the Express app and add middleware.
const app = express();
app.use(express.json());  // To parse JSON request bodies
app.use(cors());          // Enable CORS

// Setup OpenAI API configuration using your API key from environment variables.
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

/**
 * Helper function: getConversation
 * Retrieves the conversation history for a given Telegram chat ID from Firestore.
 * If the document doesn't exist, returns a default conversation with a system message.
 */
async function getConversation(chatId) {
  try {
    const docRef = db.collection('conversations').doc(String(chatId));
    const doc = await docRef.get();
    if (doc.exists) {
      // Return stored messages if found.
      return doc.data().messages;
    } else {
      // No conversation found; start with a default system prompt.
      return [{ role: 'system', content: 'You are a helpful assistant.' }];
    }
  } catch (error) {
    console.error("Error in getConversation:", error);
    // In case of error, fall back to a default conversation.
    return [{ role: 'system', content: 'You are a helpful assistant.' }];
  }
}

/**
 * Helper function: saveConversation
 * Saves the updated conversation history for a given chat ID back to Firestore.
 */
async function saveConversation(chatId, messages) {
  try {
    const docRef = db.collection('conversations').doc(String(chatId));
    await docRef.set({ messages });
  } catch (error) {
    console.error("Error in saveConversation:", error);
  }
}

/**
 * Helper function: sendMessageToTelegram
 * Sends a message to a specific Telegram chat using the Telegram Bot API.
 */
async function sendMessageToTelegram(chatId, text) {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  // Construct the Telegram API endpoint URL using the bot token.
  const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The body includes the chat ID and the text message to send.
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    });
  } catch (error) {
    console.error('Error sending message to Telegram:', error);
  }
}

/**
 * Telegram Webhook Endpoint
 * This endpoint receives updates (messages) from Telegram.
 */
app.post('/telegram/webhook', async (req, res) => {
  try {
    const update = req.body;
    // Check if the update contains a message
    if (update.message) {
      const chatId = update.message.chat.id;         // Unique identifier for the Telegram chat/user
      const userMessage = update.message.text;          // The text of the incoming message

      // Retrieve the conversation history from Firestore for this chat.
      const messages = await getConversation(chatId);

      // Append the new user message to the conversation history.
      messages.push({ role: 'user', content: userMessage });

      // Call OpenAI's Chat Completion API using the full conversation history.
      const completion = await openai.createChatCompletion({
        model: 'gpt-4o-mini', // Replace with your model name if necessary (e.g., gpt-3.5-turbo)
        messages: messages,
      });

      // Extract the assistant's reply from the API response.
      const assistantReply = completion.data.choices[0].message.content;

      // Append the assistant's reply to the conversation history.
      messages.push({ role: 'assistant', content: assistantReply });

      // Save the updated conversation history back to Firestore.
      await saveConversation(chatId, messages);

      // Send the assistant's reply back to the user via Telegram.
      await sendMessageToTelegram(chatId, assistantReply);
    }
    // Always respond with status 200 to Telegram.
    res.sendStatus(200);
  } catch (error) {
    console.error('Error handling Telegram webhook:', error);
    res.sendStatus(500);
  }
});

// A simple health check endpoint
app.get('/', (req, res) => {
  res.send('Telegram bot with Firestore is up and running!');
});

// Start the Express server on the specified PORT.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
