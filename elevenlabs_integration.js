// elevenlabs.js - Enhanced ElevenLabs Integration Module
const axios = require('axios');

class ElevenLabsService {
  constructor(apiKey, defaultVoiceId = 'EXAVITQu4vr4xnSDxMaL') {
    this.apiKey = apiKey;
    this.defaultVoiceId = defaultVoiceId; // Default to Bella voice
    this.baseUrl = 'https://api.elevenlabs.io/v1';
    
    this.axiosConfig = {
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey
      }
    };
  }

  /**
   * Convert text to speech using ElevenLabs API
   * @param {string} text - Text to convert
   * @param {string} voiceId - Voice ID to use (optional)
   * @param {object} voiceSettings - Voice configuration (optional)
   * @returns {Buffer} Audio buffer
   */
  async textToSpeech(text, voiceId = null, voiceSettings = null) {
    try {
      const voice = voiceId || this.defaultVoiceId;
      const settings = voiceSettings || {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
      };

      const response = await axios.post(
        `${this.baseUrl}/text-to-speech/${voice}`,
        {
          text: text,
          model_id: "eleven_monolingual_v1",
          voice_settings: settings
        },
        {
          ...this.axiosConfig,
          responseType: 'arraybuffer'
        }
      );

      return Buffer.from(response.data);
    } catch (error) {
      console.error('ElevenLabs TTS Error:', error.response?.data || error.message);
      throw new Error(`TTS conversion failed: ${error.response?.data || error.message}`);
    }
  }

  /**
   * Get available voices
   * @returns {Array} List of available voices
   */
  async getVoices() {
    try {
      const response = await axios.get(`${this.baseUrl}/voices`, {
        headers: {
          'xi-api-key': this.apiKey
        }
      });
      
      return response.data.voices;
    } catch (error) {
      console.error('Error fetching voices:', error);
      throw error;
    }
  }

  /**
   * Stream text to speech (for real-time applications)
   * @param {string} text - Text to convert
   * @param {string} voiceId - Voice ID
   * @returns {Stream} Audio stream
   */
  async streamTextToSpeech(text, voiceId = null) {
    try {
      const voice = voiceId || this.defaultVoiceId;
      
      const response = await axios.post(
        `${this.baseUrl}/text-to-speech/${voice}/stream`,
        {
          text: text,
          model_id: "eleven_monolingual_v1",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        },
        {
          ...this.axiosConfig,
          responseType: 'stream'
        }
      );

      return response.data;
    } catch (error) {
      console.error('ElevenLabs Streaming Error:', error);
      throw error;
    }
  }
}

// Integration with existing voice assistant backend
function addElevenLabsToServer(app, elevenLabsService) {
  
  // Endpoint to get available voices
  app.get('/api/voices', async (req, res) => {
    try {
      if (!elevenLabsService) {
        return res.status(400).json({ error: 'ElevenLabs service not configured' });
      }
      
      const voices = await elevenLabsService.getVoices();
      res.json(voices);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch voices' });
    }
  });

  // Enhanced process-command endpoint with ElevenLabs TTS
  app.post('/api/process-command-enhanced', async (req, res) => {
    try {
      const { message, user_id, voice_id, use_elevenlabs = true } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      // Process command with OpenAI (same logic as before)
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
            
            Keep responses concise and conversational for text-to-speech.`
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

      // Handle function calls (same as before)
      if (responseMessage.function_call) {
        const functionName = responseMessage.function_call.name;
        const functionArgs = JSON.parse(responseMessage.function_call.arguments);
        
        let functionResult;
        
        switch (functionName) {
          case 'getCalendarEvents':
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
        }

        const followUpCompletion = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'Format response naturally for text-to-speech. Keep it concise.'
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

      // Generate audio with ElevenLabs if enabled and service available
      let audioData = null;
      if (use_elevenlabs && elevenLabsService) {
        try {
          const audioBuffer = await elevenLabsService.textToSpeech(finalResponse, voice_id);
          audioData = audioBuffer.toString('base64');
        } catch (error) {
          console.error('ElevenLabs TTS failed, falling back to text response:', error);
        }
      }

      res.json({
        response: finalResponse,
        audio: audioData,
        user_id: user_id || 'anonymous',
        voice_used: voice_id || elevenLabsService?.defaultVoiceId
      });

    } catch (error) {
      console.error('Error processing enhanced command:', error);
      res.status(500).json({ 
        error: 'Failed to process command',
        message: error.message 
      });
    }
  });

  // Stream TTS endpoint for real-time audio
  app.post('/api/stream-tts', async (req, res) => {
    try {
      const { text, voice_id } = req.body;
      
      if (!elevenLabsService) {
        return res.status(400).json({ error: 'ElevenLabs service not configured' });
      }
      
      if (!text) {
        return res.status(400).json({ error: 'Text is required' });
      }

      const audioStream = await elevenLabsService.streamTextToSpeech(text, voice_id);
      
      res.setHeader('Content-Type', 'audio/mpeg');
      audioStream.pipe(res);
      
    } catch (error) {
      console.error('Streaming TTS error:', error);
      res.status(500).json({ error: 'Failed to stream audio' });
    }
  });
}

// Updated server.js integration
function updateServerWithElevenLabs() {
  // Add to your server.js file after the existing code:
  
  // Initialize ElevenLabs service if API key is provided
  let elevenLabsService = null;
  if (process.env.ELEVENLABS_API_KEY) {
    elevenLabsService = new ElevenLabsService(
      process.env.ELEVENLABS_API_KEY,
      process.env.ELEVENLABS_VOICE_ID
    );
    console.log('ElevenLabs service initialized');
  } else {
    console.log('ElevenLabs API key not provided, using browser TTS only');
  }
  
  // Add ElevenLabs endpoints to server
  addElevenLabsToServer(app, elevenLabsService);
  
  // Make elevenLabsService available globally
  global.elevenLabsService = elevenLabsService;
}

// Frontend JavaScript enhancement for ElevenLabs audio
const frontendElevenLabsIntegration = `
// Add this to your HTML file's JavaScript section

class EnhancedVoiceAssistant extends VoiceAssistant {
    constructor() {
        super();
        this.useElevenLabs = true;
        this.selectedVoiceId = null;
        this.loadVoices();
    }
    
    async loadVoices() {
        try {
            const response = await fetch(\`\${this.apiUrl}/api/voices\`);
            if (response.ok) {
                const voices = await response.json();
                this.availableVoices = voices;
                this.createVoiceSelector();
            }
        } catch (error) {
            console.error('Failed to load ElevenLabs voices:', error);
        }
    }
    
    createVoiceSelector() {
        const voiceSelector = document.createElement('select');
        voiceSelector.id = 'voiceSelector';
        voiceSelector.className = 'control-btn';
        voiceSelector.style.width = 'auto';
        
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Default Voice';
        voiceSelector.appendChild(defaultOption);
        
        this.availableVoices?.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.voice_id;
            option.textContent = voice.name;
            voiceSelector.appendChild(option);
        });
        
        voiceSelector.addEventListener('change', (e) => {
            this.selectedVoiceId = e.target.value || null;
        });
        
        // Add to controls
        const controls = document.querySelector('.controls');
        controls.appendChild(voiceSelector);
    }
    
    async processCommand(transcript) {
        this.isProcessing = true;
        this.updateUI();
        this.status.textContent = 'Processing...';
        
        try {
            const endpoint = this.useElevenLabs ? 
                '/api/process-command-enhanced' : 
                '/api/process-command';
                
            const response = await fetch(\`\${this.apiUrl}\${endpoint}\`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: transcript,
                    user_id: this.getUserId(),
                    voice_id: this.selectedVoiceId,
                    use_elevenlabs: this.useElevenLabs
                })
            });
            
            if (!response.ok) {
                throw new Error(\`HTTP error! status: \${response.status}\`);
            }
            
            const data = await response.json();
            this.response.textContent = data.response;
            
            // Play ElevenLabs audio if available, otherwise use browser TTS
            if (data.audio && this.useElevenLabs) {
                this.playAudioFromBase64(data.audio);
            } else {
                this.speakResponse(data.response);
            }
            
        } catch (error) {
            console.error('Error processing command:', error);
            this.showError(\`Error: \${error.message}\`);
            this.response.textContent = 'Sorry, I encountered an error processing your request.';
        } finally {
            this.isProcessing = false;
            this.updateUI();
            this.status.textContent = 'Tap the microphone to start';
        }
    }
    
    playAudioFromBase64(base64Audio) {
        try {
            const audioBlob = new Blob([
                Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0))
            ], { type: 'audio/mpeg' });
            
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            
            audio.play().catch(error => {
                console.error('Audio playback failed:', error);
                // Fallback to browser TTS
                this.speakResponse(this.response.textContent);
            });
            
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
            };
        } catch (error) {
            console.error('Error playing ElevenLabs audio:', error);
            this.speakResponse(this.response.textContent);
        }
    }
}

// Replace the initialization
document.addEventListener('DOMContentLoaded', () => {
    window.voiceAssistant = new EnhancedVoiceAssistant();
});
`;

module.exports = {
  ElevenLabsService,
  addElevenLabsToServer,
  updateServerWithElevenLabs,
  frontendElevenLabsIntegration
};