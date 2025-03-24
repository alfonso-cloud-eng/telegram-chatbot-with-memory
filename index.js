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

// Use the default credentials (Cloud Run service account)
admin.initializeApp();

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
 * Retrieves the conversation history for a given custom document ID from Firestore.
 * If the document doesn't exist, returns a default conversation with a system message.
 */
async function getConversation(docId) {
  try {
    const docRef = db.collection('conversations').doc(docId);
    const doc = await docRef.get();
    if (doc.exists) {
      // Return stored messages if found.
      return doc.data().messages;
    } else {
      // No conversation found; start with a default system prompt from the .env file.
      return [{ role: 'system', content: process.env.SYSTEM_PROMPT || 'You are a helpful assistant.' }];
    }
  } catch (error) {
    console.error("Error in getConversation:", error);
    // In case of error, fall back to the .env system prompt.
    return [{ role: 'system', content: process.env.SYSTEM_PROMPT || 'You are a helpful assistant.' }];
  }
}

/**
 * Helper function: saveConversation
 * Saves the updated conversation history for a given custom document ID back to Firestore.
 */
async function saveConversation(docId, messages) {
  const docRef = db.collection('conversations').doc(docId);
  await docRef.set({ messages });
}

// Function to send messages back to Telegram
async function sendMessageToTelegram(chatId, text) {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    });
  } catch (error) {
    console.error('Error sending message to Telegram:', error);
  }
}

// Telegram webhook endpoint to receive messages
app.post('/telegram/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update.message) {
      const chat = update.message.chat;
      const chatId = chat.id;
      const userMessage = update.message.text;
      
      // If the user sends "/start", reply with a default welcome message and do not process further.
      const welcomeMessage = fs.readFileSync('welcome_message.txt', 'utf8');
      if (userMessage.trim() === '/start') {
        await sendMessageToTelegram(chatId, welcomeMessage);
        return res.sendStatus(200);
      }
      
      
      // Create a custom document ID that includes the username (if available) and chatId.
      let docId = String(chatId);
      if (chat.username) {
        docId = `@${chat.username}-${chatId}`;
      }

      // Retrieve the conversation history from Firestore using the custom document ID
      let messages = await getConversation(docId);
      
      // Retrieve the system prompt from the .env file (with a fallback default)
      const systemPrompt = process.env.SYSTEM_PROMPT || 'You are a helpful assistant.';
      const systemMessage = { role: 'system', content: systemPrompt };
      // Ensure the conversation starts with the updated system message
      if (messages.length === 0 || messages[0].role !== 'system') {
        messages.unshift(systemMessage);
      } else {
        messages[0] = systemMessage;
      }
      
      // Append the new user message
      messages.push({ role: 'user', content: userMessage });
      
      // Call OpenAI with the conversation history (including system prompt)
      const completion = await openai.createChatCompletion({
        model: 'gpt-4o-mini', // or use 'gpt-4' if available
        messages: messages,
      });
      const assistantReply = completion.data.choices[0].message.content;
      
      // Append the assistant's reply to the conversation history
      messages.push({ role: 'assistant', content: assistantReply });
      
      // Save the updated conversation back to Firestore using the custom document ID
      await saveConversation(docId, messages);
      
      // Send the reply back to the user on Telegram
      await sendMessageToTelegram(chatId, assistantReply);
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('Error handling Telegram webhook:', error);
    res.sendStatus(500);
  }
});

// Simple route to test server health
app.get('/', (req, res) => {
  res.send('Telegram bot with Firestore is up and running!');
});

// Start the server
const PORT = 8080;
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
