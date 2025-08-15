# ResponderGPT 2.0

Sistema de resposta automática para WhatsApp com IA integrada, suportando processamento de voz, imagem e mensagens temporárias.

## 🚀 Características

- **Integração com IA**: Suporte para OpenAI GPT e Google Gemini
- **Processamento de Áudio**: Transcrição automática de mensagens de voz
- **Análise de Imagens**: Processamento e descrição de imagens enviadas
- **Respostas em Áudio**: Conversão de texto para fala usando Google TTS ou OpenAI
- **Detecção de Loops**: Sistema inteligente para prevenir loops de mensagens
- **Mensagens Temporárias**: Compatibilidade com mensagens temporárias do WhatsApp
- **Interface Web**: Dashboard para monitoramento e configuração
- **Rate Limiting**: Controle de taxa de mensagens por usuário
- **Notificações Externas**: Sistema de notificação para vendedores

## 📋 Pré-requisitos

- Node.js >= 16.0.0
- FFmpeg (incluído no projeto)
- Chave da API OpenAI ou Google Gemini
- Conta do Google Cloud (opcional, para TTS)

## 🛠️ Instalação

1. Clone o repositório:
```bash
git clone https://github.com/giovanycoelho/respondergpt2.0.git
cd respondergpt2.0
```

2. Instale as dependências:
```bash
npm install
```

3. Configure suas chaves de API no arquivo `config.json` ou através da interface web.

4. Execute o projeto:
```bash
npm start
```

5. Acesse a interface web em `http://localhost:3000`

## ⚙️ Configuração

O sistema pode ser configurado através da interface web ou editando o arquivo `config.json`:

```json
{
  "openaiApiKey": "sua-chave-openai",
  "geminiApiKey": "sua-chave-gemini",
  "aiModel": "gpt-4o-mini",
  "systemPrompt": "Você é um assistente útil do WhatsApp.",
  "audioResponses": true,
  "audioProvider": "gemini",
  "ephemeralMessageHandling": true
}
```

## 🔧 Funcionalidades Principais

### Processamento de Mensagens
- Detecção automática de tipo de mensagem (texto, áudio, imagem)
- Histórico de conversas com limite configurável
- Sistema de delay humanizado para respostas

### Mensagens Temporárias
- Detecção automática de mensagens temporárias
- Envio otimizado para compatibilidade com versões antigas do WhatsApp
- Configuração opcional para ativar/desativar o tratamento especial

### Sistema de Áudio
- Transcrição de áudio usando OpenAI Whisper
- Síntese de fala com múltiplos provedores
- Fallback automático entre provedores

### Monitoramento
- Dashboard em tempo real
- Logs detalhados do sistema
- Métricas de performance
- Status de conexão

## 📁 Estrutura do Projeto

```
├── whatsapp.js          # Arquivo principal
├── main.js              # Electron main process
├── package.json         # Dependências e scripts
├── config.json          # Configurações (criado automaticamente)
├── index.html           # Interface web principal
├── dashboard_flowbx.html # Dashboard alternativo
├── ffmpeg/              # Binários do FFmpeg
└── auth_info_baileys/   # Dados de autenticação do WhatsApp
```

## 🚀 Scripts Disponíveis

- `npm start` - Inicia a aplicação Electron
- `npm run dev` - Executa em modo desenvolvimento com nodemon
- `npm run build` - Constrói a aplicação para distribuição
- `npm run build-win` - Build específico para Windows
- `npm run build-mac` - Build específico para macOS
- `npm run build-linux` - Build específico para Linux

## 🔒 Segurança

- Rate limiting por usuário
- Circuit breaker para APIs externas
- Validação de entrada
- Logs de segurança

## 🤝 Contribuição

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📝 Licença

Este projeto está sob a licença ISC. Veja o arquivo `LICENSE` para mais detalhes.

## 🆘 Suporte

Para suporte e dúvidas, abra uma issue no GitHub ou entre em contato através dos canais oficiais.

## 📊 Changelog

### v2.0.0
- Adicionado suporte para mensagens temporárias
- Melhorado sistema de detecção de loops
- Implementado fallback entre provedores de áudio
- Otimizações de performance
- Interface web aprimorada

---

**ResponderGPT 2.0** - Sistema inteligente de resposta automática para WhatsApp