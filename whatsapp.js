const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage, jidNormalizedUser, delay } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const FormData = require('form-data');
const axios = require('axios');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');

// Configuração do ffmpeg
ffmpeg.setFfmpegPath('./ffmpeg/bin/ffmpeg.exe');

// Configuração do cliente Text-to-Speech
const ttsClient = new TextToSpeechClient();

// Configuração do Express e Socket.IO
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(express.static('.'));
app.use(express.json());

// Configuração das instâncias Axios
let openaiAxios;
let geminiAxios;

// Variáveis globais
let sock;
let qrCodeData = null;
let isConnected = false;
let connectionStatus = 'Desconectado';
let lastActivity = new Date();
let messageCount = 0;
let errorCount = 0;

// Sistema de controle de taxa (Rate Limiting)
const rateLimiter = {
    requests: new Map(),
    maxRequests: 10,
    windowMs: 60000, // 1 minuto
    
    isAllowed(userId) {
        const now = Date.now();
        const userRequests = this.requests.get(userId) || [];
        
        // Remove requisições antigas
        const validRequests = userRequests.filter(time => now - time < this.windowMs);
        
        if (validRequests.length >= this.maxRequests) {
            return false;
        }
        
        validRequests.push(now);
        this.requests.set(userId, validRequests);
        return true;
    }
};

// Sistema de Circuit Breaker para APIs
const circuitBreaker = {
    openai: { failures: 0, lastFailure: 0, isOpen: false },
    gemini: { failures: 0, lastFailure: 0, isOpen: false },
    maxFailures: 5,
    timeout: 300000, // 5 minutos
    
    canMakeRequest(service) {
        const breaker = this[service];
        if (!breaker.isOpen) return true;
        
        const now = Date.now();
        if (now - breaker.lastFailure > this.timeout) {
            breaker.isOpen = false;
            breaker.failures = 0;
            return true;
        }
        return false;
    },
    
    recordFailure(service) {
        const breaker = this[service];
        breaker.failures++;
        breaker.lastFailure = Date.now();
        
        if (breaker.failures >= this.maxFailures) {
            breaker.isOpen = true;
            console.log(`Circuit breaker aberto para ${service}`);
        }
    },
    
    recordSuccess(service) {
        const breaker = this[service];
        breaker.failures = 0;
        breaker.isOpen = false;
    }
};

// Sistema de detecção de loop de mensagens
const loopDetector = {
    messages: new Map(),
    maxSimilarMessages: 3,
    timeWindow: 300000, // 5 minutos
    
    isLoop(userId, message) {
        const now = Date.now();
        const userMessages = this.messages.get(userId) || [];
        
        // Remove mensagens antigas
        const recentMessages = userMessages.filter(msg => now - msg.timestamp < this.timeWindow);
        
        // Conta mensagens similares
        const similarCount = recentMessages.filter(msg => 
            this.calculateSimilarity(msg.content, message) > 0.8
        ).length;
        
        // Adiciona nova mensagem
        recentMessages.push({ content: message, timestamp: now });
        this.messages.set(userId, recentMessages);
        
        return similarCount >= this.maxSimilarMessages;
    },
    
    calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    },
    
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }
};

// Configuração padrão
let config = {
    openaiApiKey: '',
    geminiApiKey: '',
    aiModel: 'gpt-3.5-turbo',
    responseDelay: 2000,
    rateLimitEnabled: true,
    ephemeralMessageHandling: true,
    loopDetectionEnabled: true
};

// Função para carregar configuração
function loadConfig() {
    try {
        if (fs.existsSync('./config.json')) {
            const configFile = fs.readFileSync('./config.json', 'utf8');
            config = { ...config, ...JSON.parse(configFile) };
            console.log('✅ Configuração carregada com sucesso');
        } else {
            console.log('⚠️ Arquivo config.json não encontrado, usando configuração padrão');
        }
    } catch (error) {
        console.error('❌ Erro ao carregar configuração:', error);
    }
}

// Função para salvar configuração
function saveConfig() {
    try {
        fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
        console.log('✅ Configuração salva com sucesso');
    } catch (error) {
        console.error('❌ Erro ao salvar configuração:', error);
    }
}

// Função para configurar instâncias Axios
function setupAxiosInstances() {
    if (config.openaiApiKey) {
        openaiAxios = axios.create({
            baseURL: 'https://api.openai.com/v1',
            headers: {
                'Authorization': `Bearer ${config.openaiApiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
    }
    
    if (config.geminiApiKey) {
        geminiAxios = axios.create({
            baseURL: 'https://generativelanguage.googleapis.com/v1beta',
            timeout: 30000
        });
    }
}

// Função para formatar número de telefone
function formatPhoneNumber(number) {
    // Remove caracteres não numéricos
    let cleaned = number.replace(/\D/g, '');
    
    // Se começar com 55 (código do Brasil), remove
    if (cleaned.startsWith('55')) {
        cleaned = cleaned.substring(2);
    }
    
    // Adiciona 9 se for celular e não tiver
    if (cleaned.length === 10 && ['11', '12', '13', '14', '15', '16', '17', '18', '19', '21', '22', '24', '27', '28'].includes(cleaned.substring(0, 2))) {
        cleaned = cleaned.substring(0, 2) + '9' + cleaned.substring(2);
    }
    
    return cleaned;
}

// Função para extrair número do ID do chat
function extractNumberFromChatId(chatId) {
    return chatId.split('@')[0].split(':')[0];
}

// Função para forçar sincronização de chats não lidos
async function forceSyncUnreadChats() {
    try {
        if (sock) {
            console.log('🔄 Forçando sincronização de chats não lidos...');
            await sock.chatModify({ markRead: false }, undefined);
            console.log('✅ Sincronização de chats concluída');
        }
    } catch (error) {
        console.error('❌ Erro ao sincronizar chats:', error);
    }
}

// Função para gerar resumo da conversa
function generateConversationSummary(messages) {
    const recentMessages = messages.slice(-10); // Últimas 10 mensagens
    return recentMessages.map(msg => {
        const sender = msg.key.fromMe ? 'Eu' : 'Cliente';
        const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[Mídia]';
        return `${sender}: ${content}`;
    }).join('\n');
}

// Função para extrair nome do cliente
function extractClientName(message) {
    const pushName = message.pushName;
    const contact = message.key.remoteJid;
    
    if (pushName && pushName.trim() !== '') {
        return pushName.trim();
    }
    
    // Extrai número do contato como fallback
    const number = extractNumberFromChatId(contact);
    return `Cliente ${number.substring(-4)}`;
}

// Função para enviar notificação para vendedor
async function notifyVendedor(clientName, message, chatId) {
    try {
        // Simula clique no link do WhatsApp para abrir conversa
        const whatsappLink = `https://wa.me/${extractNumberFromChatId(chatId)}`;
        
        console.log(`📱 Nova mensagem de ${clientName}:`);
        console.log(`💬 ${message}`);
        console.log(`🔗 Link: ${whatsappLink}`);
        
        // Emite evento via Socket.IO para interface web
        io.emit('newMessage', {
            clientName,
            message,
            chatId,
            whatsappLink,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Erro ao notificar vendedor:', error);
    }
}

// Função para transcrever áudio
async function transcribeAudio(audioBuffer) {
    try {
        if (!openaiAxios || !circuitBreaker.canMakeRequest('openai')) {
            throw new Error('OpenAI não disponível');
        }
        
        // Salva áudio temporariamente
        const tempAudioPath = `temp_audio_${Date.now()}.ogg`;
        fs.writeFileSync(tempAudioPath, audioBuffer);
        
        // Converte para MP3
        const mp3Path = tempAudioPath.replace('.ogg', '.mp3');
        
        await new Promise((resolve, reject) => {
            ffmpeg(tempAudioPath)
                .toFormat('mp3')
                .on('end', resolve)
                .on('error', reject)
                .save(mp3Path);
        });
        
        // Prepara FormData para envio
        const formData = new FormData();
        formData.append('file', fs.createReadStream(mp3Path));
        formData.append('model', 'whisper-1');
        
        const response = await openaiAxios.post('/audio/transcriptions', formData, {
            headers: formData.getHeaders()
        });
        
        // Limpa arquivos temporários
        fs.unlinkSync(tempAudioPath);
        fs.unlinkSync(mp3Path);
        
        circuitBreaker.recordSuccess('openai');
        return response.data.text;
        
    } catch (error) {
        console.error('❌ Erro na transcrição de áudio:', error);
        circuitBreaker.recordFailure('openai');
        return '[Áudio não pôde ser transcrito]';
    }
}

// Função para processar imagem
async function processImage(imageBuffer, mimeType) {
    try {
        if (!openaiAxios || !circuitBreaker.canMakeRequest('openai')) {
            throw new Error('OpenAI não disponível');
        }
        
        const base64Image = imageBuffer.toString('base64');
        
        const response = await openaiAxios.post('/chat/completions', {
            model: 'gpt-4-vision-preview',
            messages: [{
                role: 'user',
                content: [{
                    type: 'text',
                    text: 'Descreva esta imagem de forma detalhada e útil para um atendimento comercial.'
                }, {
                    type: 'image_url',
                    image_url: {
                        url: `data:${mimeType};base64,${base64Image}`
                    }
                }]
            }],
            max_tokens: 300
        });
        
        circuitBreaker.recordSuccess('openai');
        return response.data.choices[0].message.content;
        
    } catch (error) {
        console.error('❌ Erro no processamento de imagem:', error);
        circuitBreaker.recordFailure('openai');
        return '[Imagem recebida - não foi possível processar]';
    }
}

// Função para gerar resposta da IA
async function generateAIResponse(message, context = '') {
    try {
        let response;
        
        if (config.aiModel.includes('gpt') && openaiAxios && circuitBreaker.canMakeRequest('openai')) {
            const prompt = `Contexto da conversa:\n${context}\n\nMensagem atual: ${message}\n\nResponda de forma natural, útil e amigável como um assistente comercial.`;
            
            const apiResponse = await openaiAxios.post('/chat/completions', {
                model: config.aiModel,
                messages: [{
                    role: 'system',
                    content: 'Você é um assistente comercial inteligente e prestativo. Responda de forma natural e amigável.'
                }, {
                    role: 'user',
                    content: prompt
                }],
                max_tokens: 500,
                temperature: 0.7
            });
            
            response = apiResponse.data.choices[0].message.content;
            circuitBreaker.recordSuccess('openai');
            
        } else if (config.aiModel.includes('gemini') && geminiAxios && circuitBreaker.canMakeRequest('gemini')) {
            const prompt = `Contexto da conversa:\n${context}\n\nMensagem atual: ${message}\n\nResponda de forma natural, útil e amigável como um assistente comercial.`;
            
            const apiResponse = await geminiAxios.post(`/models/${config.aiModel}:generateContent?key=${config.geminiApiKey}`, {
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 500
                }
            });
            
            response = apiResponse.data.candidates[0].content.parts[0].text;
            circuitBreaker.recordSuccess('gemini');
            
        } else {
            throw new Error('Nenhuma API de IA disponível');
        }
        
        return response;
        
    } catch (error) {
        console.error('❌ Erro ao gerar resposta da IA:', error);
        
        if (config.aiModel.includes('gpt')) {
            circuitBreaker.recordFailure('openai');
        } else if (config.aiModel.includes('gemini')) {
            circuitBreaker.recordFailure('gemini');
        }
        
        return 'Desculpe, estou com dificuldades técnicas no momento. Um de nossos atendentes entrará em contato em breve.';
    }
}

// Função para verificar se a mensagem é efêmera
function isEphemeralMessage(message) {
    try {
        // Verifica se a mensagem tem propriedades de mensagem efêmera
        if (message && message.message) {
            // Verifica diferentes tipos de mensagem efêmera
            const messageContent = message.message;
            
            // Verifica se é uma mensagem com timer de desaparecimento
            if (messageContent.ephemeralMessage) {
                return true;
            }
            
            // Verifica se tem contextInfo com ephemeralExpiration
            if (messageContent.extendedTextMessage?.contextInfo?.ephemeralExpiration ||
                messageContent.conversation?.contextInfo?.ephemeralExpiration ||
                messageContent.imageMessage?.contextInfo?.ephemeralExpiration ||
                messageContent.videoMessage?.contextInfo?.ephemeralExpiration ||
                messageContent.audioMessage?.contextInfo?.ephemeralExpiration ||
                messageContent.documentMessage?.contextInfo?.ephemeralExpiration) {
                return true;
            }
            
            // Verifica se a mensagem em si tem ephemeralExpiration
            if (messageContent.ephemeralExpiration) {
                return true;
            }
        }
        
        // Verifica propriedades do key da mensagem
        if (message && message.key) {
            if (message.key.ephemeralExpiration) {
                return true;
            }
        }
        
        return false;
    } catch (error) {
        console.error('❌ Erro ao verificar mensagem efêmera:', error);
        return false;
    }
}

// Função principal para processar mensagens
async function processMessage(message) {
    try {
        const chatId = message.key.remoteJid;
        const userId = extractNumberFromChatId(chatId);
        const isFromMe = message.key.fromMe;
        
        // Ignora mensagens próprias
        if (isFromMe) return;
        
        // Verifica se é mensagem efêmera e se deve ser ignorada
        if (config.ephemeralMessageHandling && isEphemeralMessage(message)) {
            console.log('⏰ Mensagem efêmera detectada - ignorando conforme configuração');
            return;
        }
        
        // Verifica rate limiting
        if (config.rateLimitEnabled && !rateLimiter.isAllowed(userId)) {
            console.log(`⚠️ Rate limit atingido para usuário ${userId}`);
            return;
        }
        
        let messageText = '';
        let mediaProcessed = false;
        
        // Processa diferentes tipos de mensagem
        if (message.message?.conversation) {
            messageText = message.message.conversation;
        } else if (message.message?.extendedTextMessage?.text) {
            messageText = message.message.extendedTextMessage.text;
        } else if (message.message?.audioMessage) {
            try {
                const audioBuffer = await downloadMediaMessage(message, 'buffer', {});
                messageText = await transcribeAudio(audioBuffer);
                mediaProcessed = true;
            } catch (error) {
                console.error('❌ Erro ao processar áudio:', error);
                messageText = '[Mensagem de áudio recebida]';
            }
        } else if (message.message?.imageMessage) {
            try {
                const imageBuffer = await downloadMediaMessage(message, 'buffer', {});
                const mimeType = message.message.imageMessage.mimetype;
                messageText = await processImage(imageBuffer, mimeType);
                mediaProcessed = true;
            } catch (error) {
                console.error('❌ Erro ao processar imagem:', error);
                messageText = '[Imagem recebida]';
            }
        } else if (message.message?.videoMessage) {
            messageText = '[Vídeo recebido]';
        } else if (message.message?.documentMessage) {
            const fileName = message.message.documentMessage.fileName || 'documento';
            messageText = `[Documento recebido: ${fileName}]`;
        } else {
            messageText = '[Mensagem não suportada]';
        }
        
        // Verifica detecção de loop
        if (config.loopDetectionEnabled && loopDetector.isLoop(userId, messageText)) {
            console.log(`🔄 Loop detectado para usuário ${userId} - ignorando mensagem`);
            return;
        }
        
        // Extrai nome do cliente
        const clientName = extractClientName(message);
        
        // Notifica vendedor
        await notifyVendedor(clientName, messageText, chatId);
        
        // Gera contexto da conversa (implementação simplificada)
        const context = `Cliente: ${clientName}\nMensagem: ${messageText}`;
        
        // Gera resposta da IA
        const aiResponse = await generateAIResponse(messageText, context);
        
        // Aplica delay configurado
        if (config.responseDelay > 0) {
            await delay(config.responseDelay);
        }
        
        // Envia resposta
        await sock.sendMessage(chatId, { text: aiResponse });
        
        // Atualiza estatísticas
        messageCount++;
        lastActivity = new Date();
        
        // Emite estatísticas via Socket.IO
        io.emit('stats', {
            messageCount,
            errorCount,
            lastActivity: lastActivity.toISOString(),
            connectionStatus
        });
        
        console.log(`✅ Resposta enviada para ${clientName}: ${aiResponse.substring(0, 50)}...`);
        
    } catch (error) {
        console.error('❌ Erro ao processar mensagem:', error);
        errorCount++;
        
        // Emite erro via Socket.IO
        io.emit('error', {
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

// Função para conectar ao WhatsApp
async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ['ResponderGPT', 'Chrome', '1.0.0'],
            defaultQueryTimeoutMs: 60000
        });
        
        // Event listeners
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrCodeData = qr;
                qrcode.generate(qr, { small: true });
                console.log('📱 QR Code gerado - escaneie com seu WhatsApp');
                
                // Emite QR code via Socket.IO
                io.emit('qrCode', qr);
            }
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                
                isConnected = false;
                connectionStatus = 'Desconectado';
                
                console.log('❌ Conexão fechada devido a:', lastDisconnect?.error);
                
                if (shouldReconnect) {
                    console.log('🔄 Tentando reconectar...');
                    setTimeout(connectToWhatsApp, 5000);
                } else {
                    console.log('🚪 Deslogado do WhatsApp');
                    qrCodeData = null;
                }
                
                // Emite status via Socket.IO
                io.emit('connectionStatus', {
                    isConnected,
                    status: connectionStatus,
                    timestamp: new Date().toISOString()
                });
            } else if (connection === 'open') {
                isConnected = true;
                connectionStatus = 'Conectado';
                qrCodeData = null;
                
                console.log('✅ Conectado ao WhatsApp com sucesso!');
                
                // Força sincronização de chats
                setTimeout(forceSyncUnreadChats, 3000);
                
                // Emite status via Socket.IO
                io.emit('connectionStatus', {
                    isConnected,
                    status: connectionStatus,
                    timestamp: new Date().toISOString()
                });
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('messages.upsert', async (m) => {
            const messages = m.messages;
            
            for (const message of messages) {
                if (message.key && message.key.remoteJid && !message.key.fromMe) {
                    await processMessage(message);
                }
            }
        });
        
        // Listener para mensagens lidas
        sock.ev.on('messages.update', (updates) => {
            for (const update of updates) {
                if (update.update.readStatus) {
                    console.log(`📖 Mensagem lida: ${update.key.id}`);
                }
            }
        });
        
        // Listener para presença
        sock.ev.on('presence.update', (presence) => {
            console.log(`👤 Presença atualizada: ${presence.id} - ${presence.presences?.[presence.id]?.lastKnownPresence}`);
        });
        
    } catch (error) {
        console.error('❌ Erro ao conectar ao WhatsApp:', error);
        errorCount++;
        
        // Tenta reconectar após 10 segundos
        setTimeout(connectToWhatsApp, 10000);
    }
}

// Rotas da API
app.get('/api/status', (req, res) => {
    res.json({
        isConnected,
        connectionStatus,
        messageCount,
        errorCount,
        lastActivity: lastActivity.toISOString(),
        qrCodeData,
        config: {
            aiModel: config.aiModel,
            responseDelay: config.responseDelay,
            rateLimitEnabled: config.rateLimitEnabled,
            ephemeralMessageHandling: config.ephemeralMessageHandling,
            loopDetectionEnabled: config.loopDetectionEnabled
        }
    });
});

app.post('/api/config', (req, res) => {
    try {
        const newConfig = req.body;
        
        // Valida configurações
        if (newConfig.responseDelay && (newConfig.responseDelay < 0 || newConfig.responseDelay > 30000)) {
            return res.status(400).json({ error: 'Delay de resposta deve estar entre 0 e 30000ms' });
        }
        
        // Atualiza configuração
        config = { ...config, ...newConfig };
        
        // Reconfigura instâncias Axios se necessário
        if (newConfig.openaiApiKey || newConfig.geminiApiKey) {
            setupAxiosInstances();
        }
        
        // Salva configuração
        saveConfig();
        
        res.json({ success: true, config });
        
    } catch (error) {
        console.error('❌ Erro ao atualizar configuração:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/send-message', async (req, res) => {
    try {
        const { number, message } = req.body;
        
        if (!isConnected) {
            return res.status(400).json({ error: 'WhatsApp não está conectado' });
        }
        
        if (!number || !message) {
            return res.status(400).json({ error: 'Número e mensagem são obrigatórios' });
        }
        
        const formattedNumber = formatPhoneNumber(number);
        const chatId = `${formattedNumber}@s.whatsapp.net`;
        
        await sock.sendMessage(chatId, { text: message });
        
        res.json({ success: true, message: 'Mensagem enviada com sucesso' });
        
    } catch (error) {
        console.error('❌ Erro ao enviar mensagem:', error);
        res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
});

app.post('/api/logout', async (req, res) => {
    try {
        if (sock) {
            await sock.logout();
        }
        
        // Remove arquivos de autenticação
        const authDir = './auth_info_baileys';
        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
        }
        
        isConnected = false;
        connectionStatus = 'Desconectado';
        qrCodeData = null;
        
        res.json({ success: true, message: 'Logout realizado com sucesso' });
        
    } catch (error) {
        console.error('❌ Erro ao fazer logout:', error);
        res.status(500).json({ error: 'Erro ao fazer logout' });
    }
});

// Socket.IO events
io.on('connection', (socket) => {
    console.log('🔌 Cliente conectado via Socket.IO');
    
    // Envia status atual
    socket.emit('connectionStatus', {
        isConnected,
        status: connectionStatus,
        timestamp: new Date().toISOString()
    });
    
    // Envia QR code se disponível
    if (qrCodeData) {
        socket.emit('qrCode', qrCodeData);
    }
    
    // Envia estatísticas
    socket.emit('stats', {
        messageCount,
        errorCount,
        lastActivity: lastActivity.toISOString(),
        connectionStatus
    });
    
    socket.on('disconnect', () => {
        console.log('🔌 Cliente desconectado do Socket.IO');
    });
});

// Função de inicialização
async function initialize() {
    console.log('🚀 Iniciando ResponderGPT 2.0...');
    
    // Carrega configuração
    loadConfig();
    
    // Configura instâncias Axios
    setupAxiosInstances();
    
    // Conecta ao WhatsApp
    await connectToWhatsApp();
    
    // Inicia servidor
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`🌐 Servidor rodando na porta ${PORT}`);
        console.log(`📱 Interface disponível em: http://localhost:${PORT}`);
    });
    
    // Configura handlers de processo
    process.on('SIGINT', async () => {
        console.log('\n🛑 Encerrando aplicação...');
        
        if (sock) {
            await sock.end();
        }
        
        server.close(() => {
            console.log('✅ Aplicação encerrada com sucesso');
            process.exit(0);
        });
    });
    
    process.on('uncaughtException', (error) => {
        console.error('❌ Erro não capturado:', error);
        errorCount++;
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Promise rejeitada não tratada:', reason);
        errorCount++;
    });
}

// Inicia a aplicação
if (require.main === module) {
    initialize().catch(console.error);
}

module.exports = {
    initialize,
    connectToWhatsApp,
    processMessage,
    generateAIResponse,
    isEphemeralMessage,
    config
};