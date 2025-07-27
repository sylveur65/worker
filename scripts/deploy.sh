#!/bin/bash

# Script de déploiement pour Video Moderation Worker v2
# Usage: ./scripts/deploy.sh

set -e

echo "🚀 Déploiement de Video Moderation Worker v2"

# Couleurs pour les messages
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fonction pour afficher les messages
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Vérifier si on est sur Ubuntu/Debian
if ! command -v apt &> /dev/null; then
    log_error "Ce script est conçu pour Ubuntu/Debian. Veuillez adapter pour votre distribution."
    exit 1
fi

# Vérifier si Node.js est installé
if ! command -v node &> /dev/null; then
    log_info "Installation de Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    log_success "Node.js installé"
else
    log_info "Node.js déjà installé: $(node --version)"
fi

# Vérifier si FFmpeg est installé
if ! command -v ffmpeg &> /dev/null; then
    log_info "Installation de FFmpeg..."
    sudo apt update
    sudo apt install -y ffmpeg
    log_success "FFmpeg installé"
else
    log_info "FFmpeg déjà installé: $(ffmpeg -version | head -n1)"
fi

# Vérifier si PM2 est installé
if ! command -v pm2 &> /dev/null; then
    log_info "Installation de PM2..."
    sudo npm install -g pm2
    log_success "PM2 installé"
else
    log_info "PM2 déjà installé: $(pm2 --version)"
fi

# Créer les dossiers nécessaires
log_info "Création des dossiers..."
mkdir -p temp logs
chmod 755 temp logs

# Installer les dépendances
log_info "Installation des dépendances..."
npm install

# Vérifier si le fichier .env existe
if [ ! -f .env ]; then
    log_warning "Fichier .env non trouvé. Création depuis l'exemple..."
    if [ -f env.example ]; then
        cp env.example .env
        log_warning "Veuillez configurer le fichier .env avec vos variables d'environnement"
        log_warning "Variables requises:"
        log_warning "  - CLOUDFLARE_R2_ENDPOINT"
        log_warning "  - CLOUDFLARE_ACCESS_KEY_ID"
        log_warning "  - CLOUDFLARE_SECRET_ACCESS_KEY"
        log_warning "  - CLOUDFLARE_BUCKET_NAME"
        log_warning "  - AZURE_CONTENT_SAFETY_ENDPOINT"
        log_warning "  - AZURE_CONTENT_SAFETY_KEY"
    else
        log_error "Fichier env.example non trouvé"
        exit 1
    fi
else
    log_success "Fichier .env trouvé"
fi

# Vérifier la configuration
log_info "Vérification de la configuration..."
if node -e "
const config = require('./config/config');
try {
    config.validate();
    console.log('✅ Configuration valide');
} catch (error) {
    console.error('❌ Erreur de configuration:', error.message);
    process.exit(1);
}
"; then
    log_success "Configuration validée"
else
    log_error "Erreur de configuration. Veuillez vérifier votre fichier .env"
    exit 1
fi

# Créer le fichier ecosystem.config.js pour PM2
log_info "Création de la configuration PM2..."
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'video-moderation-worker',
    script: 'app.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true
  }]
};
EOF

# Tester le démarrage
log_info "Test de démarrage..."
if timeout 10s node app.js > /dev/null 2>&1; then
    log_success "Test de démarrage réussi"
else
    log_warning "Test de démarrage échoué (timeout). Cela peut être normal si la configuration n'est pas complète."
fi

# Démarrer avec PM2
log_info "Démarrage avec PM2..."
pm2 start ecosystem.config.js

# Sauvegarder la configuration PM2
pm2 save

# Configurer le démarrage automatique
pm2 startup

log_success "Déploiement terminé !"
log_info "Commandes utiles:"
log_info "  - Voir les logs: pm2 logs video-moderation-worker"
log_info "  - Redémarrer: pm2 restart video-moderation-worker"
log_info "  - Arrêter: pm2 stop video-moderation-worker"
log_info "  - Status: pm2 status"
log_info "  - Monitoring: pm2 monit"

# Afficher le status
pm2 status

echo ""
log_success "🎉 Video Moderation Worker v2 est maintenant déployé et en cours d'exécution !" 