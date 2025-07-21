const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const readline = require('readline');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');
const winston = require('winston');
const cron = require('node-cron');

// Configuration initiale
dotenv.config();
const CONFIG = {
  PREFIX: process.env.PREFIX || '.',
  ADMIN_NUMBER: process.env.ADMIN_NUMBER,
  MEDIA: {
    WELCOME_IMAGE_URL: process.env.WELCOME_IMAGE_URL || 'https://via.placeholder.com/500',
    CHANNEL_LINK: process.env.CHANNEL_LINK || 'https://whatsapp.com/channel/example'
  },
  SETTINGS: {
    FAKE_RECORDING: process.env.FAKE_RECORDING === 'true',
    STAY_ONLINE: process.env.STAY_ONLINE === 'true',
    RESTART_ON_CRASH: process.env.RESTART_ON_CRASH === 'true'
  }
};

// Setup Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Initialisation
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let client;
let fakeRecordingIntervals = new Map();

async function initializeBot() {
  try {
    // Verify required directories exist
    await fs.ensureDir('sessions');
    await fs.ensureDir('logs');
    await fs.ensureDir('storage/media');

    // Configuration interactive
    if (!process.env.PREFIX) {
      CONFIG.PREFIX = await askQuestion('📌 Choisissez un préfixe pour les commandes (ex: ., #, €) : ') || '.';
    }

    // Load settings interactively if not in .env
    if (process.env.FAKE_RECORDING === undefined) {
      CONFIG.SETTINGS.FAKE_RECORDING = (await askQuestion('🎙️ Activer le fake recording? (true/false) : ')) === 'true';
    }
    
    if (process.env.STAY_ONLINE === undefined) {
      CONFIG.SETTINGS.STAY_ONLINE = (await askQuestion('🔌 Maintenir en ligne si téléphone éteint? (true/false) : ')) === 'true';
    }

    const userNumber = process.env.ADMIN_NUMBER || await askQuestion('📱 Entrez votre numéro WhatsApp (ex: +33612345678) : ');

    logger.info('Initializing WhatsApp bot...');
    console.log('\n🔗 Initialisation du bot...');

    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './sessions',
        clientId: 'main_session',
        backupSyncIntervalMs: 300000
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      },
      takeoverOnConflict: CONFIG.SETTINGS.STAY_ONLINE,
      restartOnAuthFail: CONFIG.SETTINGS.STAY_ONLINE
    });

    setupEventHandlers(client, userNumber);
    client.initialize();

    // Setup daily backup
    cron.schedule('0 3 * * *', () => backupData());
    
  } catch (error) {
    logger.error('Initialization error:', error);
    if (CONFIG.SETTINGS.RESTART_ON_CRASH) {
      setTimeout(() => process.exit(1), 2000);
    } else {
      process.exit(1);
    }
  }
}

function setupEventHandlers(client, userNumber) {
  client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    logger.info('QR code generated');
  });

  client.on('authenticated', () => {
    logger.info('Authenticated successfully');
  });

  client.on('auth_failure', msg => {
    logger.error('Authentication failure:', msg);
  });

  client.on('ready', async () => {
    logger.info('Client is ready');
    console.log('\n🤖 Bot opérationnel !');
    
    try {
      await sendWelcomeMessage(client, userNumber);
      startCommandListener();
      await checkAdminCommands(client);
    } catch (error) {
      logger.error('Ready handler error:', error);
    }
  });

  client.on('disconnected', reason => {
    logger.warn('Client was logged out', reason);
    if (CONFIG.SETTINGS.STAY_ONLINE) {
      logger.info('Attempting to reconnect...');
      client.initialize();
    }
  });

  client.on('message', async msg => {
    logger.info(`Received message from ${msg.from}: ${msg.body}`);
    
    // Fake recording feature
    if (CONFIG.SETTINGS.FAKE_RECORDING && !msg.fromMe) {
      await triggerFakeRecording(msg);
    }
  });
}

async function triggerFakeRecording(msg) {
  try {
    const chat = await msg.getChat();
    
    // Clear existing interval if any
    if (fakeRecordingIntervals.has(chat.id._serialized)) {
      clearInterval(fakeRecordingIntervals.get(chat.id._serialized));
      fakeRecordingIntervals.delete(chat.id._serialized);
    }
    
    // Start recording indication
    await chat.sendStateRecording();
    
    // Set timeout to stop after 12 seconds
    const interval = setTimeout(async () => {
      await chat.clearState();
      fakeRecordingIntervals.delete(chat.id._serialized);
    }, 12000);
    
    fakeRecordingIntervals.set(chat.id._serialized, interval);
    
  } catch (error) {
    logger.error('Error in fake recording:', error);
  }
}

async function sendWelcomeMessage(client, userNumber) {
  try {
    const media = await MessageMedia.fromUrl(CONFIG.MEDIA.WELCOME_IMAGE_URL, {
      unsafeMime: true
    });
    
    await client.sendMessage(
      userNumber,
      media,
      { 
        caption: `✅ Je suis connecté !\nTapez ${CONFIG.PREFIX}menu pour afficher les commandes\n\n${CONFIG.MEDIA.CHANNEL_LINK}` 
      }
    );
    logger.info('Welcome message sent');
  } catch (e) {
    logger.error('Error sending welcome message:', e);
    console.error('Erreur lors de l\'envoi du message de bienvenue:', e);
  }
}

function startCommandListener() {
  client.on('message', async msg => {
    if (!msg.body.startsWith(CONFIG.PREFIX)) return;

    const [command, ...args] = msg.body.slice(CONFIG.PREFIX.length).trim().split(' ');
    logger.info(`Command received: ${command}`, { args });

    try {
      switch(command.toLowerCase()) {
        case 'tagall':
          await tagAllMembers(msg);
          break;
        case 'kick':
          await kickMember(msg, args[0]);
          break;
        case 'extension':
          await clearGroup(msg);
          break;
        case 'friends':
          await sendFriendMessages(msg);
          break;
        case 'menu':
          await showMenu(msg);
          break;
        case 'backup':
          await backupData(msg);
          break;
        case 'restart':
          await restartBot(msg);
          break;
        case 'settings':
          await showSettings(msg);
          break;
        default:
          await msg.reply('❌ Commande inconnue. Tapez *.menu* pour la liste.');
      }
    } catch (error) {
      logger.error(`Error executing command ${command}:`, error);
      await msg.reply('⚠️ Une erreur est survenue lors de l\'exécution de la commande');
    }
  });
}

// Command implementations
async function tagAllMembers(msg) {
  if (!msg.isGroupMsg) {
    return await msg.reply('❌ Cette commande ne fonctionne que dans les groupes');
  }

  try {
    const chat = await msg.getChat();
    const members = await chat.participants;
    const mentions = members.map(m => `@${m.id.user}`);
    await msg.reply(`📢 Mention de groupe:\n${mentions.join(' ')}`);
    logger.info(`Tagged all members in group ${chat.id.user}`);
  } catch (error) {
    logger.error('Error in tagAllMembers:', error);
    throw error;
  }
}

async function kickMember(msg, userId) {
  if (!msg.isGroupMsg) {
    return await msg.reply('❌ Cette commande ne fonctionne que dans les groupes');
  }

  try {
    const chat = await msg.getChat();
    if (!(await isAdmin(msg))) {
      return await msg.reply('❌ Commande réservée aux admins');
    }

    if (!userId) {
      return await msg.reply('❌ Usage: *.kick @numéro*');
    }

    const normalizedUserId = userId.replace('@', '') + '@c.us';
    await chat.removeParticipants([normalizedUserId]);
    await msg.reply(`🚪 Utilisateur ${userId} expulsé`);
    logger.info(`Kicked user ${userId} from group ${chat.id.user}`);
  } catch (error) {
    logger.error('Error in kickMember:', error);
    throw error;
  }
}

async function clearGroup(msg) {
  if (!msg.isGroupMsg) {
    return await msg.reply('❌ Cette commande ne fonctionne que dans les groupes');
  }

  try {
    const chat = await msg.getChat();
    if (!(await isAdmin(msg))) {
      return await msg.reply('❌ Commande réservée aux admins');
    }

    await msg.reply('⚠️ Suppression de tous les membres dans 5 secondes');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const members = (await chat.participants).filter(p => !p.isAdmin);
    await chat.removeParticipants(members.map(m => m.id._serialized));
    
    await msg.reply(`✅ ${members.length} membres ont été supprimés`);
    logger.info(`Cleared group ${chat.id.user}, removed ${members.length} members`);
  } catch (error) {
    logger.error('Error in clearGroup:', error);
    throw error;
  }
}

async function sendFriendMessages(msg) {
  try {
    if (!(await isAdmin(msg))) {
      return await msg.reply('❌ Commande réservée aux admins');
    }

    const targetNumber = await askQuestion('Entrez le numéro de destination (ex: +33612345678) : ');
    if (!targetNumber) {
      return await msg.reply('❌ Numéro invalide');
    }

    const normalizedNumber = targetNumber.replace('+', '').replace(/\s/g, '') + '@c.us';
    
    for (let i = 0; i < 3; i++) {
      await client.sendMessage(
        normalizedNumber,
        ['Salut !', 'Tu vas bien ?', 'Je suis un bot connecté à ce compte'][i]
      );
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    await msg.reply('✅ Messages envoyés avec succès');
    logger.info(`Sent friend messages to ${normalizedNumber}`);
  } catch (error) {
    logger.error('Error in sendFriendMessages:', error);
    throw error;
  }
}

async function showMenu(msg) {
  const menu = `
📜 *Menu des commandes* :
${CONFIG.PREFIX}tagall - Mentionner tous les membres (groupe)
${CONFIG.PREFIX}kick @numéro - Expulser un membre (admin)
${CONFIG.PREFIX}extension - Vider le groupe (admin)
${CONFIG.PREFIX}friends - Envoyer des messages d'amitié (admin)
${CONFIG.PREFIX}backup - Sauvegarder les données
${CONFIG.PREFIX}restart - Redémarrer le bot (admin)
${CONFIG.PREFIX}settings - Afficher les paramètres
`.trim();
  
  await msg.reply(menu);
  logger.info('Sent menu to user');
}

async function showSettings(msg) {
  if (!(await isAdmin(msg))) {
    return await msg.reply('❌ Commande réservée aux admins');
  }

  const settingsInfo = `
⚙️ *Paramètres actuels* :
- Fake Recording: ${CONFIG.SETTINGS.FAKE_RECORDING ? '✅ Activé' : '❌ Désactivé'}
- Stay Online: ${CONFIG.SETTINGS.STAY_ONLINE ? '✅ Activé' : '❌ Désactivé'}
- Restart On Crash: ${CONFIG.SETTINGS.RESTART_ON_CRASH ? '✅ Activé' : '❌ Désactivé'}
`.trim();

  await msg.reply(settingsInfo);
  logger.info('Displayed settings to admin');
}

async function backupData(msg = null) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join('storage', 'backups', timestamp);
    
    await fs.ensureDir(backupDir);
    await fs.copy('sessions', path.join(backupDir, 'sessions'));
    await fs.copy('storage/media', path.join(backupDir, 'media'));
    
    const result = `✅ Backup créé : ${backupDir}`;
    logger.info(result);
    
    if (msg) {
      await msg.reply(result);
    }
  } catch (error) {
    const errMsg = '❌ Erreur lors du backup';
    logger.error(errMsg, error);
    
    if (msg) {
      await msg.reply(errMsg);
    }
  }
}

async function restartBot(msg) {
  if (!(await isAdmin(msg))) {
    return await msg.reply('❌ Commande réservée aux admins');
  }

  await msg.reply('🔄 Redémarrage en cours...');
  logger.info('Restarting bot...');
  process.exit(0);
}

// Helper functions
async function isAdmin(msg) {
  try {
    if (msg.from === CONFIG.ADMIN_NUMBER + '@c.us') return true;
    
    if (msg.isGroupMsg) {
      const chat = await msg.getChat();
      const participant = chat.participants.find(p => p.id.user === msg.author.replace('@c.us', ''));
      return participant && participant.isAdmin;
    }
    
    return false;
  } catch (error) {
    logger.error('Error in isAdmin check:', error);
    return false;
  }
}

function askQuestion(question) {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', error => {
  logger.error('Uncaught Exception:', error);
  if (CONFIG.SETTINGS.RESTART_ON_CRASH) {
    setTimeout(() => process.exit(1), 2000);
  } else {
    process.exit(1);
  }
});

// Start the bot
initializeBot();
