const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// Keep a global reference of the window object
let mainWindow;
let whatsappServer;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // Remove default frame
    titleBarStyle: 'hidden', // Hide title bar but keep window controls
    titleBarOverlay: {
      color: '#000000', // Black title bar
      symbolColor: '#00ff88', // Green window controls
      height: 30
    },
    backgroundColor: '#000000', // Black background
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: 'ResponderGpt2', // New app name
    icon: path.join(__dirname, 'icoresponder.png') // Ícone oficial do programa
  });

  // Remove menu bar completely
  Menu.setApplicationMenu(null);

  // Load the index.html file
  mainWindow.loadFile('index.html');

  // Open DevTools for debugging
  mainWindow.webContents.openDevTools();

  // Start the WhatsApp server
  startWhatsAppServer();
}

function startWhatsAppServer() {
  // Start the WhatsApp server as a separate process
  whatsappServer = spawn('node', ['whatsapp.js'], {
    stdio: 'inherit'
  });

  // Handle server exit
  whatsappServer.on('exit', (code, signal) => {
    console.log(`WhatsApp server exited with code ${code} and signal ${signal}`);
  });

  // Handle server errors
  whatsappServer.on('error', (err) => {
    console.error('Failed to start WhatsApp server:', err);
  });
}

// Kill the WhatsApp server when the app is closed
function stopWhatsAppServer() {
  if (whatsappServer) {
    whatsappServer.kill();
  }
}

// This method will be called when Electron has finished initialization
app.whenReady().then(createWindow);

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    stopWhatsAppServer();
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Kill the WhatsApp server when the app is about to quit
app.on('before-quit', () => {
  stopWhatsAppServer();
});