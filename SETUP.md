# Guia de Configuração Inicial - ResponderGPT 2.0

## 📋 Checklist de Instalação

### 1. Pré-requisitos
- [ ] Node.js >= 16.0.0 instalado
- [ ] Git instalado
- [ ] Chave da API OpenAI ou Google Gemini
- [ ] Conta do Google Cloud (opcional, para TTS)

### 2. Instalação

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/respondergpt2.0.git
cd respondergpt2.0

# Instale as dependências
npm install
```

### 3. Configuração Obrigatória

1. **Copie o arquivo de configuração de exemplo:**
   ```bash
   cp config.example.json config.json
   ```

2. **Edite o arquivo `config.json` com suas chaves de API:**
   ```json
   {
     "openaiApiKey": "sk-sua-chave-openai-aqui",
     "geminiApiKey": "sua-chave-gemini-aqui",
     "aiModel": "gpt-4o-mini",
     "geminiModel": "gemini-1.5-flash"
   }
   ```

### 4. Primeira Execução

```bash
# Execute o projeto
npm start
```

### 5. Configuração do WhatsApp

1. Acesse `http://localhost:3000` no seu navegador
2. Escaneie o QR Code com seu WhatsApp
3. Aguarde a conexão ser estabelecida
4. Configure as opções através da interface web

### 6. Configurações Importantes

#### APIs Necessárias:
- **OpenAI**: Para processamento de texto e áudio
- **Google Gemini**: Alternativa para processamento de texto
- **Google Cloud TTS**: Para síntese de voz (opcional)

#### Configurações Recomendadas:
```json
{
  "maxTokens": 1000,
  "temperature": 0.7,
  "responseDelay": {
    "min": 1000,
    "max": 3000
  },
  "rateLimiting": {
    "enabled": true,
    "maxMessages": 10,
    "windowMs": 60000
  },
  "ephemeralMessageHandling": true
}
```

### 7. Verificação da Instalação

- [ ] Servidor iniciado na porta 3000
- [ ] Interface web acessível
- [ ] QR Code gerado
- [ ] WhatsApp conectado
- [ ] Logs do sistema funcionando

### 8. Solução de Problemas Comuns

#### Erro: "Module not found"
```bash
npm install
```

#### Erro: "API Key inválida"
- Verifique se as chaves estão corretas no `config.json`
- Confirme se as chaves têm permissões adequadas

#### Erro: "Port 3000 already in use"
- Altere a porta no código ou termine o processo que está usando a porta

#### WhatsApp não conecta
- Verifique sua conexão com a internet
- Tente gerar um novo QR Code
- Reinicie a aplicação

### 9. Estrutura de Arquivos Importantes

```
responder-gpt2.0/
├── config.json          # ⚠️ CRIAR: Suas configurações
├── config.example.json   # Exemplo de configuração
├── whatsapp.js          # Arquivo principal
├── index.html           # Interface web
├── package.json         # Dependências
├── README.md            # Documentação
└── auth_info_baileys/   # 🔒 Dados de autenticação (criado automaticamente)
```

### 10. Segurança

⚠️ **IMPORTANTE**: 
- Nunca compartilhe seu arquivo `config.json`
- Mantenha suas chaves de API seguras
- O arquivo `auth_info_baileys/` contém dados sensíveis
- Use `.gitignore` para proteger arquivos sensíveis

### 11. Próximos Passos

1. Teste o sistema enviando mensagens
2. Configure o prompt do sistema conforme necessário
3. Ajuste os delays e rate limiting
4. Monitore os logs para verificar o funcionamento
5. Configure notificações externas (se necessário)

---

**Dica**: Mantenha sempre um backup das suas configurações e dados de autenticação!