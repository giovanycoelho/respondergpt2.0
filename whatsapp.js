// WhatsApp client implementation using Baileys
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { default: axios } = require('axios');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const FormData = require('form-data');
const textToSpeech = require('@google-cloud/text-to-speech');

// Set the path to ffmpeg (adjust for your system)
ffmpeg.setFfmpegPath(path.join(__dirname, 'ffmpeg', 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe'));

// Create axios instances with connection pooling
const openaiAxios = axios.create({
  baseURL: 'https://api.openai.com/v1',
  timeout: 30000,
  maxContentLength: 50 * 1024 * 1024, // 50MB
  maxBodyLength: 50 * 1024 * 1024,
  httpAgent: new (require('http').Agent)({
    keepAlive: true,
    maxSockets: 20,
    maxFreeSockets: 10,
    timeout: 30000
  }),
  httpsAgent: new (require('https').Agent)({
    keepAlive: true,
    maxSockets: 20,
    maxFreeSockets: 10,
    timeout: 30000
  })
});

const geminiAxios = axios.create({
  baseURL: 'https://generativelanguage.googleapis.com/v1beta',
  timeout: 30000,
  maxContentLength: 50 * 1024 * 1024,
  maxBodyLength: 50 * 1024 * 1024,
  httpAgent: new (require('http').Agent)({
    keepAlive: true,
    maxSockets: 15,
    maxFreeSockets: 8,
    timeout: 30000
  }),
  httpsAgent: new (require('https').Agent)({
    keepAlive: true,
    maxSockets: 15,
    maxFreeSockets: 8,
    timeout: 30000
  })
});

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store for active connections
let sock = null;
let qrData = null;
let isConnected = false;
let isConnecting = false;
let connectionRetryCount = 0;
let connectedPhoneNumber = null;
const MAX_CONNECTION_RETRIES = 3;

// Store for tracking calls to prevent spam
const callTracker = new Map();

// Rate limiting per user
const userRateLimit = new Map();
const MAX_MESSAGES_PER_MINUTE = 10;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute

// Circuit breaker for API calls
const circuitBreaker = {
  openai: { failures: 0, lastFailure: 0, isOpen: false, threshold: 5, timeout: 30000 },
  gemini: { failures: 0, lastFailure: 0, isOpen: false, threshold: 5, timeout: 30000 }
};

// Enhanced logging
function logWithTimestamp(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logData = { timestamp, level, message, ...data };
  console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data);
  io.emit('system-log', logData);
}

// Store for tracking message loops
const messageLoopTracker = new Map();
const LOOP_DETECTION_WINDOW = 15;
const LOOP_THRESHOLD = 5;
const LOOP_BLOCK_DURATION = 2 * 60 * 1000;
const MIN_LOOP_TIME_SPAN = 30 * 1000;
const SIMILARITY_THRESHOLD = 0.95;

// Default configuration
const defaultConfig = {
  openaiApiKey: '',
  aiModel: 'gpt-4o-mini',
  systemPrompt: 'Você é um assistente útil do WhatsApp.',
  responseDelay: 10,
  rejectCalls: false,
  callRejectionMessage: 'Estou indisponível no momento. Por favor, deixe uma mensagem que responderei assim que possível.',
  audioResponses: false,
  audioFallback: false,
  audioProvider: 'gemini',
  geminiApiKey: '',
  openaiTtsKey: '',
  voiceModel: 'Kore',
  externalNotifications: false,
  notificationFormat: '🔔 *Nova Solicitação de Contato*\n\n📋 *Resumo da Conversa:*\n{conversationSummary}\n\n👤 *Dados do Cliente:*\n• Nome: {clientName}\n• Telefone: {clientPhone}\n• Horário: {timestamp}\n\n💬 Por favor, entre em contato o quanto antes para dar continuidade ao atendimento.',
  notificationDelay: 5,
  ephemeralMessageHandling: true // Handle ephemeral messages with single response
};

// Load configuration from file or use defaults
function loadConfig() {
  try {
    if (fs.existsSync('config.json')) {
      const savedConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));
      console.log('Configurações carregadas do arquivo config.json');
      return { ...defaultConfig, ...savedConfig };
    } else {
      console.log('Arquivo config.json não encontrado, usando configurações padrão');
      return { ...defaultConfig };
    }
  } catch (error) {
    console.error('Erro ao carregar configurações, usando padrões:', error);
    return { ...defaultConfig };
  }
}

// Save configuration to file
function saveConfig(newConfig) {
  try {
    const configToSave = { ...config, ...newConfig };
    fs.writeFileSync('config.json', JSON.stringify(configToSave, null, 2));
    console.log('Configurações salvas em config.json');
    return configToSave;
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    return config;
  }
}

// Initialize configuration
let config = loadConfig();

// In-memory store for messages and chat history
const messageStore = new Map();
const chatHistoryStore = new Map();
const MAX_HISTORY_LENGTH = 20;

// Function to manage chat history
function updateChatHistory(chatId, role, content) {
  if (!chatHistoryStore.has(chatId)) {
    chatHistoryStore.set(chatId, []);
  }
  
  const history = chatHistoryStore.get(chatId);
  history.push({ role, content });
  
  if (history.length > MAX_HISTORY_LENGTH) {
    history.shift();
  }
  
  chatHistoryStore.set(chatId, history);
}

function getChatHistory(chatId) {
  return chatHistoryStore.get(chatId) || [];
}

function clearChatHistory(chatId) {
  chatHistoryStore.set(chatId, []);
}

// Function to detect WhatsApp links in text
function detectWhatsAppLinks(text) {
  const whatsappLinkRegex = /https?:\/\/(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/(?:\+?(\d{1,4}))?(\d+)(?:\?.*)?/g;
  const links = [];
  let match;
  
  while ((match = whatsappLinkRegex.exec(text)) !== null) {
    const fullLink = match[0];
    const countryCode = match[1] || '';
    const phoneNumber = match[2];
    const fullNumber = countryCode + phoneNumber;
    
    links.push({
      link: fullLink,
      phoneNumber: fullNumber,
      formattedPhone: formatPhoneNumber(fullNumber)
    });
  }
  
  return links;
}

// Function to format phone number
function formatPhoneNumber(phoneNumber) {
  const cleanPhone = phoneNumber.replace(/\D/g, '');
  
  if (cleanPhone.length === 11 && !cleanPhone.startsWith('55')) {
    return '55' + cleanPhone;
  } else if (cleanPhone.length === 10 && !cleanPhone.startsWith('55')) {
    return '55' + cleanPhone;
  }
  
  return cleanPhone;
}

// Function to extract phone number from chatId
function extractPhoneFromChatId(chatId) {
  return chatId.replace(/@s\.whatsapp\.net|@c\.us|@g\.us|@lid/g, '');
}

// Main message processing function
async function processIncomingMessages(m) {
  try {
    const messages = m.messages || [m];
    
    for (const msg of messages) {
      if (!msg || !msg.key || msg.key.fromMe) continue;
      
      const chatId = msg.key.remoteJid;
      const messageId = msg.key.id;
      
      // Check for ephemeral messages
      const isEphemeralMessage = msg.message?.ephemeralMessage?.message || 
                                msg.messageContextInfo?.ephemeralExpiration ||
                                msg.ephemeralExpiration;
      
      // Rate limiting check
      if (!checkRateLimit(chatId)) {
        logWithTimestamp('warn', 'Rate limit exceeded', { chatId });
        continue;
      }
      
      // Check for message loops
      if (isMessageLoopDetected(chatId)) {
        logWithTimestamp('warn', 'Message loop detected, skipping', { chatId });
        continue;
      }
      
      let messageText = '';
      let hasAudioMessage = false;
      
      // Process different message types
      if (msg.message?.conversation) {
        messageText = msg.message.conversation;
      } else if (msg.message?.extendedTextMessage?.text) {
        messageText = msg.message.extendedTextMessage.text;
      } else if (msg.message?.audioMessage) {
        hasAudioMessage = true;
        const transcription = await transcribeAudioMessage(msg);
        if (transcription) {
          messageText = transcription;
        } else {
          messageText = '[Mensagem de áudio - transcrição não disponível]';
        }
      } else if (msg.message?.imageMessage) {
        const imageAnalysis = await processImageMessage(msg);
        if (imageAnalysis) {
          messageText = `[Imagem enviada] ${imageAnalysis}`;
        } else {
          messageText = '[Imagem enviada - análise não disponível]';
        }
      }
      
      if (!messageText.trim()) continue;
      
      // Add message to loop tracker
      addMessageToLoopTracker(chatId, messageText, false);
      
      // Update chat history
      updateChatHistory(chatId, 'user', messageText);
      
      // Process message queue
      await processMessageQueue(chatId);
    }
  } catch (error) {
    logWithTimestamp('error', 'Error processing incoming messages', { error: error.message });
  }
}

// Function to generate AI response
async function generateAIResponse(chatId, messages, hasAudioMessage = false) {
  try {
    // Check circuit breaker
    if (checkCircuitBreaker('openai')) {
      throw new Error('OpenAI service temporarily unavailable');
    }
    
    const response = await openaiAxios.post('/chat/completions', {
      model: config.aiModel,
      messages: [
        { role: 'system', content: config.systemPrompt },
        ...messages
      ],
      max_tokens: config.maxTokens || 300,
      temperature: config.temperature || 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    recordSuccess('openai');
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    recordFailure('openai', error);
    throw error;
  }
}

// Function to send humanized message with ephemeral support
async function sendHumanizedMessage(chatId, text, shouldSendAudio = false, isEphemeralMessage = false) {
  try {
    if (!text || !text.trim()) {
      logWithTimestamp('warn', 'Empty message text, skipping send');
      return;
    }
    
    // For ephemeral messages, send as single message
    if (isEphemeralMessage && config.ephemeralMessageHandling) {
      await sock.sendMessage(chatId, { text: text.trim() });
      logWithTimestamp('info', 'Ephemeral message sent as single response', { chatId });
      return;
    }
    
    // Normal message processing with typing simulation
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i].trim();
      if (!sentence) continue;
      
      // Simulate typing
      await sock.sendPresenceUpdate('composing', chatId);
      
      // Calculate delay based on sentence length
      const baseDelay = Math.max(1000, sentence.length * 50);
      const randomDelay = Math.random() * 2000;
      const totalDelay = Math.min(baseDelay + randomDelay, 5000);
      
      await new Promise(resolve => setTimeout(resolve, totalDelay));
      
      // Send message
      await sock.sendMessage(chatId, { text: sentence });
      
      // Small pause between sentences
      if (i < sentences.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Send audio if enabled
    if (shouldSendAudio && config.audioResponses) {
      try {
        const audioBuffer = await synthesizeSpeech(text, config.voiceModel);
        if (audioBuffer) {
          await sock.sendMessage(chatId, {
            audio: audioBuffer,
            mimetype: 'audio/mp4',
            ptt: true
          });
        }
      } catch (audioError) {
        logWithTimestamp('error', 'Failed to send audio', { error: audioError.message });
      }
    }
    
    await sock.sendPresenceUpdate('paused', chatId);
  } catch (error) {
    logWithTimestamp('error', 'Error sending message', { error: error.message, chatId });
  }
}

// Additional helper functions would go here...
// (transcribeAudioMessage, processImageMessage, synthesizeSpeech, etc.)

// Express routes
app.use(express.json());

app.post('/config', (req, res) => {
  config = saveConfig(req.body);
  res.json({ success: true, config });
});

app.get('/config', (req, res) => {
  res.json(config);
});

app.get('/status', (req, res) => {
  res.json({ connected: isConnected, connecting: isConnecting });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Cliente conectado ao Socket.IO');
  
  // Send current QR code if available
  if (qrData) {
    socket.emit('qr', qrData);
  }
  
  // Send current connection status
  socket.emit('connection-status', {
    connected: isConnected,
    connecting: isConnecting,
    phoneNumber: connectedPhoneNumber
  });
  
  socket.on('connect-whatsapp', async () => {
    await connectToWhatsApp();
  });
  
  socket.on('disconnect-whatsapp', async () => {
    await disconnectFromWhatsApp();
  });
  
  socket.on('disconnect', () => {
    console.log('Cliente desconectado do Socket.IO');
  });
});

// Auto-reconnect function
async function attemptAutoReconnect() {
  if (!isConnected && !isConnecting) {
    console.log('Tentando reconectar automaticamente...');
    await connectToWhatsApp();
  }
}

// Start auto-reconnect
attemptAutoReconnect();

module.exports = { sock, io, config };