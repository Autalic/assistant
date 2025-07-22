const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { google } = require('googleapis');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Google Calendar setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Set credentials if available
if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });
}

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// Function definitions for OpenAI
const functions = [
  {
    name: 'getCalendarEvents',
    description: 'Get calendar events for a specific date or date range',
    parameters: {
      type: 'object',
      properties: {
        timeMin: {
          type: 'string',
          description: 'Start time in ISO format'
        },
        timeMax: {
          type: 'string',
          description: 'End time in ISO format'
        },
        query: {
          type: 'string',
          description: 'Search query for events'
        }
      },
      required: ['timeMin', 'timeMax']
    }
  },
  {
    name: 'createCalendarEvent',
    description: 'Create a new calendar event',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Event title/summary'
        },
        start: {
          type: 'string',
          description: 'Start time in ISO format'
        },
        end: {
          type: 'string',
          description: 'End time in ISO format'
        },
        description: {
          type: 'string',
          description: 'Event description'
        },
        attendees: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              email: { type: 'string' }
            }
          }
        }
      },
      required: ['summary', 'start', 'end']
    }
  },
  {
    name: 'getCurrentTime',
    description: 'Get the current date and time',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
];

// Helper function to parse relative dates
function parseRelativeDate(input) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  if (input.includes('today')) {
    return {
      start: new Date(today),
      end: new Date(today.getTime() + 24 * 60 * 60 * 1000)
    };
  } else if (input.includes('tomorrow')) {
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    return {
      start: tomorrow,
      end: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)
    };
  } else if (input.includes('this week')) {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { start: weekStart, end: weekEnd };
  }
  
  // Default to today
  return {
    start: new Date(today),
    end: new Date(today.getTime() + 24 * 60 * 60 * 1000)
  };
}

// Function implementations
async function getCalendarEvents(timeMin, timeMax, query = '') {
  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      q: query || undefined
    });

    const events = response.data.items || [];
    return events.map(event => ({
      id: event.id,
      summary: event.summary || 'No title',
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
      description: event.description || '',
      location: event.location || ''
    }));
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    throw new Error('Failed to fetch calendar events');
  }
}

async function createCalendarEvent(summary, start, end, description = '', attendees = []) {
  try {
    const event = {
      summary,
      start: { dateTime: start },
      end: { dateTime: end },
      description,
      attendees: attendees.map(email => ({ email }))
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event
    });

    return {
      id: response.data.id,
      summary: response.data.summary,
      start: response.data.start.dateTime,
      end: response.data.end.dateTime,
      htmlLink: response.data.htmlLink
    };
  } catch (error) {
    console.error('Error creating calendar event:', error);
    throw new Error('Failed to create calendar event');
  }
}

function getCurrentTime() {
  return {
    currentTime: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

// Main endpoint for processing voice commands
app.post('/api/process-command', async (req, res) => {
  try {
    const { message, user_id } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log('Processing command:', message);

    // Use OpenAI to interpret the command and decide if function calling is needed
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are a helpful voice assistant. You can help with calendar management.
          Current date and time: ${new Date().toISOString()}
          
          When users ask about calendar events, use the getCalendarEvents function.
          When users want to create events, use the createCalendarEvent function.
          Parse relative dates like "today", "tomorrow", "this week" appropriately.
          
          Be conversational and natural in your responses, as they will be spoken aloud.`
        },
        {
          role: 'user',
          content: message
        }
      ],
      functions: functions,
      function_call: 'auto'
    });

    const responseMessage = completion.choices[0].message;
    let finalResponse = '';

    // Handle function calls
    if (responseMessage.function_call) {
      const functionName = responseMessage.function_call.name;
      const functionArgs = JSON.parse(responseMessage.function_call.arguments);
      
      console.log(`Calling function: ${functionName}`, functionArgs);

      let functionResult;
      
      switch (functionName) {
        case 'getCalendarEvents':
          // If relative dates in original message, parse them
          if (message.toLowerCase().includes('today') || 
              message.toLowerCase().includes('tomorrow') || 
              message.toLowerCase().includes('this week')) {
            const dates = parseRelativeDate(message.toLowerCase());
            functionArgs.timeMin = dates.start.toISOString();
            functionArgs.timeMax = dates.end.toISOString();
          }
          
          functionResult = await getCalendarEvents(
            functionArgs.timeMin,
            functionArgs.timeMax,
            functionArgs.query
          );
          break;
          
        case 'createCalendarEvent':
          functionResult = await createCalendarEvent(
            functionArgs.summary,
            functionArgs.start,
            functionArgs.end,
            functionArgs.description,
            functionArgs.attendees
          );
          break;
          
        case 'getCurrentTime':
          functionResult = getCurrentTime();
          break;
          
        default:
          throw new Error(`Unknown function: ${functionName}`);
      }

      // Get the final response from OpenAI with the function result
      const followUpCompletion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful voice assistant. Format your response to be natural and conversational for text-to-speech.'
          },
          {
            role: 'user',
            content: message
          },
          responseMessage,
          {
            role: 'function',
            name: functionName,
            content: JSON.stringify(functionResult)
          }
        ]
      });

      finalResponse = followUpCompletion.choices[0].message.content;
    } else {
      finalResponse = responseMessage.content;
    }

    console.log('Final response:', finalResponse);

    res.json({
      response: finalResponse,
      user_id: user_id || 'anonymous'
    });

  } catch (error) {
    console.error('Error processing command:', error);
    res.status(500).json({ 
      error: 'Failed to process command',
      message: error.message 
    });
  }
});

// Google OAuth routes
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar']
  });
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    console.log('Refresh token:', tokens.refresh_token);
    
    res.send(`
      <h2>Authentication successful!</h2>
      <p>You can now close this window and return to your voice assistant.</p>
      <p><strong>Save this refresh token to your .env file:</strong></p>
      <code>GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}</code>
    `);
  } catch (error) {
    console.error('Error getting tokens:', error);
    res.status(500).send('Authentication failed');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Test endpoint for ElevenLabs integration
app.post('/api/elevenlabs-webhook', async (req, res) => {
  try {
    const { text, user_id } = req.body;
    
    // Process the transcribed text
    const processResponse = await axios.post('http://localhost:3000/api/process-command', {
      message: text,
      user_id: user_id
    });
    
    res.json({
      response_text: processResponse.data.response
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.listen(PORT, () => {
  module.exports = app;
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Google Auth: http://localhost:${PORT}/auth/google`);
});