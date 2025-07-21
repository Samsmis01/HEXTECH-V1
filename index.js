const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const readline = require('readline');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');
const winston = require('winston');
const cron = require('node-cron');
const { FacebookDownloader } = require('@xaviabot/fb-downloader');

// Configuration initiale
dotenv.config();
const CONFIG = {
  PREFIX: process.env.PREFIX || '.',
  OWNER_NUMBER: process.env.OWNER_NUMBER || '554488138425',
  SUDO_NUMBER: process.env.SUDO_NUMBER || '554488138425',
  OWNER_NAME: process.env.OWNER_NAME || '亗𝐇𝐄𝐗𒋲𝐓𝐄𝐂𝐇亗',
  AUTO_STATUS_SEEN: process.env.AUTO_STATUS_SEEN === 'true',
  AUTO_BIO: process.env.AUTO_BIO === 'true',
  AUTO_STATUS_REACT: process.env.AUTO_STATUS_REACT === 'true',
  AUTO_READ: process.env.AUTO_READ === 'true',
  AUTO_RECORDING: process.env.AUTO_RECORDING === 'true',
  ANTILINK: process.env.ANTILINK === 'true',
  ANTIBOT: process.env.ANTIBOT === 'true',
  ANTIBOT_WARNINGS: parseInt(process.env.ANTIBOT_WARNINGS) || 3,
  CHANNEL_LINK: process.env.CHANNEL_LINK || 'https://whatsapp.com/channel/example',
  WELCOME_IMAGE_URL: process.env.WELCOME_IMAGE_URL || 'https://via.placeholder.com/500',
  ADMINS: process.env.ADMINS ? process.env.ADMINS.split(',') : []
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
let fakeRecordingInterval;

async function initializeBot() {
  try {
    // Verify required directories exist
    await fs.ensureDir('sessions');
    await fs.ensureDir('logs');
    await fs.ensureDir('storage/media');
    await fs.ensureDir('storage/downloads');

    // Configuration interactive
    if (!process.env.PREFIX) {
      CONFIG.PREFIX = await askQuestion('📌 Choisissez un préfixe pour les commandes (ex: ., #, €) : ') || '.';
    }

    const userNumber = process.env.OWNER_NUMBER || await askQuestion('📱 Entrez votre numéro WhatsApp (ex: +33612345678) : ');

    logger.info('Initializing WhatsApp bot...');
    console.log('\n🔗 Initialisation du bot...');

    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: './sessions',
        clientId: 'main_session'
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
      takeoverOnConflict: true,
      restartOnAuthFail: true
    });

    setupEventHandlers(client, userNumber);
    client.initialize();

    // Setup daily backup
    cron.schedule('0 3 * * *', () => backupData());
    
  } catch (error) {
    logger.error('Initialization error:', error);
    process.exit(1);
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
  });

  client.on('message', async msg => {
    logger.info(`Received message from ${msg.from}: ${msg.body}`);
    
    // Fake recording feature
    if (CONFIG.AUTO_RECORDING && msg.from.includes('@g.us')) {
      if (fakeRecordingInterval) clearInterval(fakeRecordingInterval);
      
      await client.sendMessage(msg.from, {
        text: ' '
      }, {
        sendAudioAsVoice: true,
        media: Buffer.from([]),
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true
      });
      
      fakeRecordingInterval = setTimeout(() => {
        client.sendMessage(msg.from, {
          text: ' '
        }, {
          sendAudioAsVoice: true,
          media: Buffer.from([]),
          mimetype: 'audio/ogg; codecs=opus',
          ptt: false
        });
      }, 12000);
    }
  });
}

async function sendWelcomeMessage(client, userNumber) {
  try {
    const media = await MessageMedia.fromUrl(CONFIG.WELCOME_IMAGE_URL, {
      unsafeMime: true
    });
    
    await client.sendMessage(
      userNumber,
      media,
      { 
        caption: `✅ Je suis connecté !\nTapez ${CONFIG.PREFIX}menu pour afficher les commandes\n\n${CONFIG.CHANNEL_LINK}` 
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
        case 'vv':
          await downloadViewOnce(msg);
          break;
        case 'downloader':
          await downloadFacebookVideo(msg, args[0]);
          break;
        case 'ban':
          await banMember(msg, args[0]);
          break;
        case 'prompt':
          await addAdmin(msg, args[0]);
          break;
        case 'v2':
          await redirectToChannel(msg);
          break;
        case 'silence':
          await muteGroup(msg);
          break;
        case 'unmute':
          await unmuteGroup(msg);
          break;
        case 'add':
          if (args[0] === 'admin') {
            await addAdmin(msg, args[1]);
          }
          break;
        default:
          await msg.reply(`❌ Commande inconnue. Tapez ${CONFIG.PREFIX}menu pour la liste.\n\n${CONFIG.CHANNEL_LINK}`);
      }
    } catch (error) {
      logger.error(`Error executing command ${command}:`, error);
      await msg.reply(`⚠️ Une erreur est survenue lors de l\'exécution de la commande\n\n${CONFIG.CHANNEL_LINK}`);
    }
  });
}

// Command implementations
async function tagAllMembers(msg) {
  if (!msg.isGroupMsg) {
    return await msg.reply(`❌ Cette commande ne fonctionne que dans les groupes\n\n${CONFIG.CHANNEL_LINK}`);
  }

  try {
    const chat = await msg.getChat();
    const members = await chat.participants;
    const mentions = members.map(m => `@${m.id.user}`);
    await msg.reply(`📢 Mention de groupe:\n${mentions.join(' ')}\n\n${CONFIG.CHANNEL_LINK}`);
    logger.info(`Tagged all members in group ${chat.id.user}`);
  } catch (error) {
    logger.error('Error in tagAllMembers:', error);
    throw error;
  }
}

async function kickMember(msg, userId) {
  if (!msg.isGroupMsg) {
    return await msg.reply(`❌ Cette commande ne fonctionne que dans les groupes\n\n${CONFIG.CHANNEL_LINK}`);
  }

  try {
    const chat = await msg.getChat();
    if (!(await isAdmin(msg))) {
      return await msg.reply(`❌ Commande réservée aux admins\n\n${CONFIG.CHANNEL_LINK}`);
    }

    if (!userId) {
      return await msg.reply(`❌ Usage: ${CONFIG.PREFIX}kick @numéro\n\n${CONFIG.CHANNEL_LINK}`);
    }

    const normalizedUserId = userId.replace('@', '') + '@c.us';
    await chat.removeParticipants([normalizedUserId]);
    await msg.reply(`🚪 Utilisateur ${userId} expulsé\n\n${CONFIG.CHANNEL_LINK}`);
    logger.info(`Kicked user ${userId} from group ${chat.id.user}`);
  } catch (error) {
    logger.error('Error in kickMember:', error);
    throw error;
  }
}

async function clearGroup(msg) {
  if (!msg.isGroupMsg) {
    return await msg.reply(`❌ Cette commande ne fonctionne que dans les groupes\n\n${CONFIG.CHANNEL_LINK}`);
  }

  try {
    const chat = await msg.getChat();
    if (!(await isAdmin(msg))) {
      return await msg.reply(`❌ Commande réservée aux admins\n\n${CONFIG.CHANNEL_LINK}`);
    }

    await msg.reply(`⚠️ Suppression de tous les membres dans 5 secondes\n\n${CONFIG.CHANNEL_LINK}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const members = (await chat.participants).filter(p => !p.isAdmin);
    await chat.removeParticipants(members.map(m => m.id._serialized));
    
    await msg.reply(`✅ ${members.length} membres ont été supprimés\n\n${CONFIG.CHANNEL_LINK}`);
    logger.info(`Cleared group ${chat.id.user}, removed ${members.length} members`);
  } catch (error) {
    logger.error('Error in clearGroup:', error);
    throw error;
  }
}

async function sendFriendMessages(msg) {
  try {
    if (!(await isAdmin(msg))) {
      return await msg.reply(`❌ Commande réservée aux admins\n\n${CONFIG.CHANNEL_LINK}`);
    }

    const targetNumber = await askQuestion('Entrez le numéro de destination (ex: +33612345678) : ');
    if (!targetNumber) {
      return await msg.reply(`❌ Numéro invalide\n\n${CONFIG.CHANNEL_LINK}`);
    }

    const normalizedNumber = targetNumber.replace('+', '').replace(/\s/g, '') + '@c.us';
    
    for (let i = 0; i < 3; i++) {
      await client.sendMessage(
        normalizedNumber,
        ['Salut !', 'Tu vas bien ?', 'Je suis un bot connecté à ce compte'][i]
      );
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    await msg.reply(`✅ Messages envoyés avec succès\n\n${CONFIG.CHANNEL_LINK}`);
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
${CONFIG.PREFIX}vv - Sauvegarder une image en vue unique
${CONFIG.PREFIX}downloader [url] - Télécharger vidéo Facebook
${CONFIG.PREFIX}ban @numéro - Bannir un membre (admin)
${CONFIG.PREFIX}prompt @numéro - Ajouter un admin
${CONFIG.PREFIX}v2 - Lien vers notre chaîne
${CONFIG.PREFIX}silence - Fermer le groupe (admin)
${CONFIG.PREFIX}unmute - Ouvrir le groupe (admin)
${CONFIG.PREFIX}add admin @numéro - Ajouter un admin

🔗 ${CONFIG.CHANNEL_LINK}
`.trim();
  
  await msg.reply(menu);
  logger.info('Sent menu to user');
}

async function backupData(msg = null) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join('storage', 'backups', timestamp);
    
    await fs.ensureDir(backupDir);
    await fs.copy('sessions', path.join(backupDir, 'sessions'));
    await fs.copy('storage/media', path.join(backupDir, 'media'));
    
    const result = `✅ Backup créé : ${backupDir}\n\n${CONFIG.CHANNEL_LINK}`;
    logger.info(result);
    
    if (msg) {
      await msg.reply(result);
    }
  } catch (error) {
    const errMsg = `❌ Erreur lors du backup\n\n${CONFIG.CHANNEL_LINK}`;
    logger.error(errMsg, error);
    
    if (msg) {
      await msg.reply(errMsg);
    }
  }
}

async function restartBot(msg) {
  if (!(await isAdmin(msg))) {
    return await msg.reply(`❌ Commande réservée aux admins\n\n${CONFIG.CHANNEL_LINK}`);
  }

  await msg.reply(`🔄 Redémarrage en cours...\n\n${CONFIG.CHANNEL_LINK}`);
  logger.info('Restarting bot...');
  process.exit(0);
}

// New command implementations
async function downloadViewOnce(msg) {
  try {
    if (!msg.hasMedia) {
      return await msg.reply(`❌ Aucun média trouvé\n\n${CONFIG.CHANNEL_LINK}`);
    }

    const media = await msg.downloadMedia();
    const mediaPath = path.join('storage', 'downloads', `viewonce_${Date.now()}.${media.mimetype.split('/')[1]}`);
    
    await fs.writeFile(mediaPath, media.data, 'base64');
    await msg.reply(`✅ Image sauvegardée dans ${mediaPath}\n\n${CONFIG.CHANNEL_LINK}`);
    logger.info(`View once media saved to ${mediaPath}`);
  } catch (error) {
    logger.error('Error in downloadViewOnce:', error);
    await msg.reply(`❌ Erreur lors du téléchargement\n\n${CONFIG.CHANNEL_LINK}`);
  }
}

async function downloadFacebookVideo(msg, url) {
  try {
    if (!url) {
      return await msg.reply(`❌ Usage: ${CONFIG.PREFIX}downloader [url]\n\n${CONFIG.CHANNEL_LINK}`);
    }

    const videoInfo = await FacebookDownloader(url);
    if (!videoInfo || !videoInfo.hd) {
      return await msg.reply(`❌ Impossible de télécharger la vidéo\n\n${CONFIG.CHANNEL_LINK}`);
    }

    const videoPath = path.join('storage', 'downloads', `fb_${Date.now()}.mp4`);
    const writer = fs.createWriteStream(videoPath);
    
    const response = await axios({
      url: videoInfo.hd,
      method: 'GET',
      responseType: 'stream'
    });

    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const media = await MessageMedia.fromFilePath(videoPath);
    await client.sendMessage(msg.from, media, { caption: `✅ Vidéo téléchargée\n\n${CONFIG.CHANNEL_LINK}` });
    logger.info(`Facebook video downloaded to ${videoPath}`);
  } catch (error) {
    logger.error('Error in downloadFacebookVideo:', error);
    await msg.reply(`❌ Erreur lors du téléchargement\n\n${CONFIG.CHANNEL_LINK}`);
  }
}

async function banMember(msg, userId) {
  if (!msg.isGroupMsg) {
    return await msg.reply(`❌ Cette commande ne fonctionne que dans les groupes\n\n${CONFIG.CHANNEL_LINK}`);
  }

  try {
    const chat = await msg.getChat();
    if (!(await isAdmin(msg))) {
      return await msg.reply(`❌ Commande réservée aux admins\n\n${CONFIG.CHANNEL_LINK}`);
    }

    if (!userId) {
      return await msg.reply(`❌ Usage: ${CONFIG.PREFIX}ban @numéro\n\n${CONFIG.CHANNEL_LINK}`);
    }

    const normalizedUserId = userId.replace('@', '') + '@c.us';
    await chat.removeParticipants([normalizedUserId]);
    await chat.sendMessage(`@${normalizedUserId.split('@')[0]} a été banni par l'admin`, { mentions: [normalizedUserId] });
    await msg.reply(`⛔ Utilisateur ${userId} banni\n\n${CONFIG.CHANNEL_LINK}`);
    logger.info(`Banned user ${userId} from group ${chat.id.user}`);
  } catch (error) {
    logger.error('Error in banMember:', error);
    throw error;
  }
}

async function addAdmin(msg, userId) {
  try {
    if (!(await isOwner(msg))) {
      return await msg.reply(`❌ Commande réservée au propriétaire\n\n${CONFIG.CHANNEL_LINK}`);
    }

    if (!userId) {
      return await msg.reply(`❌ Usage: ${CONFIG.PREFIX}prompt @numéro\n\n${CONFIG.CHANNEL_LINK}`);
    }

    const normalizedNumber = userId.replace('+', '').replace(/\s/g, '').replace('@', '');
    if (!CONFIG.ADMINS.includes(normalizedNumber)) {
      CONFIG.ADMINS.push(normalizedNumber);
      await msg.reply(`✅ ${userId} ajouté comme admin\n\n${CONFIG.CHANNEL_LINK}`);
      logger.info(`Added admin ${userId}`);
    } else {
      await msg.reply(`ℹ️ ${userId} est déjà admin\n\n${CONFIG.CHANNEL_LINK}`);
    }
  } catch (error) {
    logger.error('Error in addAdmin:', error);
    throw error;
  }
}

async function redirectToChannel(msg) {
  try {
    await msg.reply(`📢 Rejoignez notre chaîne officielle:\n${CONFIG.CHANNEL_LINK}`);
    logger.info('Redirected user to channel');
  } catch (error) {
    logger.error('Error in redirectToChannel:', error);
    throw error;
  }
}

async function muteGroup(msg) {
  if (!msg.isGroupMsg) {
    return await msg.reply(`❌ Cette commande ne fonctionne que dans les groupes\n\n${CONFIG.CHANNEL_LINK}`);
  }

  try {
    const chat = await msg.getChat();
    if (!(await isAdmin(msg))) {
      return await msg.reply(`❌ Commande réservée aux admins\n\n${CONFIG.CHANNEL_LINK}`);
    }

    await chat.setMessagesAdminsOnly(true);
    await msg.reply(`🔇 Groupe fermé\n\n${CONFIG.CHANNEL_LINK}`);
    logger.info(`Group ${chat.id.user} muted`);
  } catch (error) {
    logger.error('Error in muteGroup:', error);
    throw error;
  }
}

async function unmuteGroup(msg) {
  if (!msg.isGroupMsg) {
    return await msg.reply(`❌ Cette commande ne fonctionne que dans les groupes\n\n${CONFIG.CHANNEL_LINK}`);
  }

  try {
    const chat = await msg.getChat();
    if (!(await isAdmin(msg))) {
      return await msg.reply(`❌ Commande réservée aux admins\n\n${CONFIG.CHANNEL_LINK}`);
    }

    await chat.setMessagesAdminsOnly(false);
    await msg.reply(`🔊 Groupe ouvert\n\n${CONFIG.CHANNEL_LINK}`);
    logger.info(`Group ${chat.id.user} unmuted`);
  } catch (error) {
    logger.error('Error in unmuteGroup:', error);
    throw error;
  }
}

// Helper functions
async function isAdmin(msg) {
  try {
    const senderNumber = msg.from.split('@')[0];
    if (senderNumber === CONFIG.OWNER_NUMBER || senderNumber === CONFIG.SUDO_NUMBER || CONFIG.ADMINS.includes(senderNumber)) {
      return true;
    }
    
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

async function isOwner(msg) {
  const senderNumber = msg.from.split('@')[0];
  return senderNumber === CONFIG.OWNER_NUMBER || senderNumber === CONFIG.SUDO_NUMBER;
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
  process.exit(1);
});

// Start the bot
initializeBot();
