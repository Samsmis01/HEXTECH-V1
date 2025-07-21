const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

console.log('🚀 Démarrage de l\'installation intelligente...');

try {
  // Vérification des prérequis
  console.log('🔍 Vérification des prérequis...');
  const nodeVersion = execSync('node -v').toString().trim();
  const npmVersion = execSync('npm -v').toString().trim();
  
  console.log(`✅ Node.js ${nodeVersion}, npm ${npmVersion}`);

  // Installation des dépendances
  console.log('📦 Installation des dépendances...');
  execSync('npm install --production --omit=dev --legacy-peer-deps', { stdio: 'inherit' });

  // Création des répertoires
  console.log('📂 Création de l\'arborescence...');
  const dirs = [
    'sessions',
    'storage/backups',
    'storage/media',
    'logs',
    'scripts'
  ];

  dirs.forEach(dir => {
    fs.ensureDirSync(dir);
    console.log(`📁 Dossier créé: ${dir}`);
  });

  // Vérification du fichier .env
  if (!fs.existsSync('.env')) {
    fs.copyFileSync('.env.example', '.env');
    console.log('⚠️ Fichier .env créé. Veuillez le configurer avant de démarrer!');
  }

  console.log('🎉 Installation terminée avec succès!');
  console.log('➡️ Commandes disponibles:');
  console.log('- npm start      : Démarrer le bot');
  console.log('- npm run dev    : Mode développement');
  console.log('- npm run backup : Lancer un backup manuel');

} catch (error) {
  console.error('❌ Erreur lors de l\'installation:', error.message);
  process.exit(1);
    
