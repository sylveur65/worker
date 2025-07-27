# Video Moderation Worker v2

Worker de modération de contenu refactorisé avec architecture modulaire pour une plateforme adulte.

## 🚀 Fonctionnalités

- **Modération d'images et vidéos** avec Azure Content Safety
- **Stockage sécurisé** sur Cloudflare R2
- **Architecture modulaire** avec séparation des responsabilités
- **Circuit breaker** pour la robustesse
- **Gestion d'erreurs JSON** garantie
- **Nettoyage automatique** des fichiers temporaires
- **Logging structuré** avec Winston
- **Validation des fichiers** (type, taille)
- **Rate limiting** et sécurité
- **Métriques** et monitoring

## 📁 Architecture

```
video-moderation-worker-v2/
├── app.js                    # Point d'entrée principal
├── package.json             # Dépendances
├── config/
│   └── config.js           # Configuration centralisée
├── services/
│   ├── azureModerationService.js  # Service Azure
│   ├── storageService.js          # Service R2
│   └── fileService.js             # Gestion fichiers
├── controllers/
│   └── moderationController.js    # Contrôleur principal
├── routes/
│   └── moderationRoutes.js        # Routes API
├── middlewares/
│   └── errorHandler.js            # Gestion d'erreurs
├── utils/
│   └── logger.js                  # Système de logging
├── temp/                          # Fichiers temporaires
├── logs/                          # Logs de l'application
└── env.example                   # Variables d'environnement
```

## 🛠️ Installation

### 1. Prérequis

- Node.js 18+ 
- FFmpeg installé sur le système
- Compte Cloudflare R2
- Compte Azure Content Safety

### 2. Installation des dépendances

```bash
cd video-moderation-worker-v2
npm install
```

### 3. Configuration

Copier le fichier d'exemple et configurer les variables :

```bash
cp env.example .env
```

Éditer `.env` avec vos valeurs :

```env
# Configuration du serveur
PORT=3001
NODE_ENV=production
LOG_LEVEL=info

# Cloudflare R2
CLOUDFLARE_R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
CLOUDFLARE_ACCESS_KEY_ID=your-access-key-id
CLOUDFLARE_SECRET_ACCESS_KEY=your-secret-access-key
CLOUDFLARE_BUCKET_NAME=your-bucket-name

# Azure Content Safety
AZURE_CONTENT_SAFETY_ENDPOINT=https://your-resource.cognitiveservices.azure.com
AZURE_CONTENT_SAFETY_KEY=your-azure-key

# CORS (optionnel)
ALLOWED_ORIGINS=https://yourdomain.com
```

### 4. Installation de FFmpeg

**Ubuntu/Debian :**
```bash
sudo apt update
sudo apt install ffmpeg
```

**CentOS/RHEL :**
```bash
sudo yum install ffmpeg
```

**macOS :**
```bash
brew install ffmpeg
```

## 🚀 Démarrage

### Mode développement
```bash
npm run dev
```

### Mode production
```bash
npm start
```

## 📡 API Endpoints

### Modération directe

**POST** `/moderate-image`
- Modère une image uploadée directement
- Body: `multipart/form-data` avec `image` et `creatorId`

**POST** `/moderate-video`
- Modère une vidéo uploadée directement
- Body: `multipart/form-data` avec `video` et `creatorId`

### Modération depuis R2

**POST** `/worker-api/moderate-image-r2`
- Modère une image stockée sur R2
- Body: `{ "r2Key": "...", "type": "image/jpeg", "creatorId": "..." }`

**POST** `/worker-api/moderate-video-r2`
- Modère une vidéo stockée sur R2
- Body: `{ "r2Key": "...", "creatorId": "..." }`

### Presigned URLs

**POST** `/worker-api/presigned-upload`
- Génère une URL d'upload R2
- Body: `{ "key": "...", "contentType": "..." }`

**POST** `/worker-api/presigned-read`
- Génère une URL de lecture R2
- Body: `{ "key": "..." }`

### Utilitaires

**POST** `/worker-api/test-moderation`
- Teste les règles de modération
- Body: `{ "testCategories": [...] }`

**GET** `/worker-api/metrics`
- Retourne les métriques des services

**GET** `/worker-api/health`
- Vérifie la santé du service

## 🔧 Configuration avancée

### Seuils de modération

Modifier `config/config.js` pour ajuster les seuils :

```javascript
moderation: {
  thresholds: {
    violence: 1,        // Seuil très bas pour violence
    weapons: 1,         // Seuil très bas pour armes
    hate: 1,            // Seuil très bas pour haine
    selfHarm: 1,        // Seuil très bas pour automutilation
    sexual: 3,          // Seuil modéré pour contenu sexuel
    child: 1            // Zéro tolérance pour enfants
  }
}
```

### Timeouts

```javascript
timeouts: {
  azureImage: 10000,    // 10s pour images
  azureVideo: 30000,    // 30s pour vidéos
  r2Upload: 60000,      // 60s pour upload R2
  r2Download: 30000     // 30s pour download R2
}
```

### Circuit Breaker

```javascript
circuitBreaker: {
  azure: {
    timeout: 30000,
    errorThresholdPercentage: 50,
    resetTimeout: 60000
  }
}
```

## 📊 Monitoring

### Logs

Les logs sont stockés dans `logs/` :
- `worker.log` - Logs généraux
- `errors.log` - Erreurs uniquement
- `metrics.log` - Métriques

### Métriques

Accéder aux métriques via `/worker-api/metrics` :

```json
{
  "success": true,
  "metrics": {
    "storage": {
      "circuitBreaker": { "state": "closed", "stats": {...} },
      "bucket": "your-bucket",
      "endpoint": "https://..."
    },
    "file": {
      "tempDir": "temp",
      "fileCount": 0,
      "maxFileSize": 335544320
    }
  }
}
```

## 🔄 Migration depuis v1

### 1. Sauvegarder l'ancien worker
```bash
mv video-moderation-worker video-moderation-worker-backup
```

### 2. Copier la nouvelle version
```bash
cp -r video-moderation-worker-v2 video-moderation-worker
cd video-moderation-worker
```

### 3. Copier la configuration
```bash
cp ../video-moderation-worker-backup/.env .
```

### 4. Installer les dépendances
```bash
npm install
```

### 5. Tester
```bash
npm run dev
```

## 🐛 Dépannage

### Erreurs courantes

**FFmpeg non trouvé :**
```bash
sudo apt install ffmpeg
```

**Permissions temp/ :**
```bash
chmod 755 temp/
```

**Variables d'environnement manquantes :**
Vérifier que `.env` contient toutes les variables requises.

### Logs de debug

Activer les logs détaillés :
```env
LOG_LEVEL=debug
NODE_ENV=development
```

## 🔒 Sécurité

- **Rate limiting** : 100 requêtes/15min par IP
- **Validation des fichiers** : Type et taille
- **CORS configurable** : Origines autorisées
- **Helmet** : Headers de sécurité
- **Circuit breaker** : Protection contre les surcharges

## 📈 Performance

- **Stockage en mémoire** : Pas d'écriture disque pour les uploads
- **Nettoyage automatique** : Fichiers temporaires supprimés
- **Timeouts optimisés** : 10s images, 30s vidéos
- **Retry logic** : Gestion des erreurs réseau

## 🤝 Contribution

1. Fork le projet
2. Créer une branche feature
3. Commit les changements
4. Push vers la branche
5. Ouvrir une Pull Request

## 📄 Licence

MIT License - voir LICENSE pour plus de détails. 