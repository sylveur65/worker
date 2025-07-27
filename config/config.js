require('dotenv').config();

const config = {
  // Server
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Cloudflare R2
  r2: {
    endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
    accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_SECRET_ACCESS_KEY,
    bucketName: process.env.CLOUDFLARE_BUCKET_NAME,
    region: 'auto'
  },
  
  // Azure Content Safety
  azure: {
    endpoint: process.env.AZURE_CONTENT_SAFETY_ENDPOINT,
    key: process.env.AZURE_CONTENT_SAFETY_KEY,
    apiVersion: '2023-10-01'
  },
  
  // Redis (pour BullMQ)
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    db: process.env.REDIS_DB || 0
  },
  
  // Modération - Seuils configurables
  moderation: {
    // Seuils pour plateforme adulte (stricts)
    thresholds: {
      violence: 1,        // Seuil très bas pour violence
      weapons: 1,         // Seuil très bas pour armes
      hate: 1,            // Seuil très bas pour haine
      selfHarm: 1,        // Seuil très bas pour automutilation
      sexual: 3,          // Seuil modéré pour contenu sexuel
      child: 1            // Zéro tolérance pour enfants
    },
    
    // Règles spéciales
    rules: {
      childWithViolence: true,    // Enfant + violence = rejet immédiat
      childWithHate: true,        // Enfant + haine = rejet immédiat
      sexualWithChild: true,      // Sexuel + enfant = rejet immédiat
      weaponBonus: 0.5,           // Bonus de sévérité pour armes
      violenceBonus: 0.5          // Bonus de sévérité pour violence
    }
  },
  
  // Upload
  upload: {
    maxFileSize: 320 * 1024 * 1024, // 320MB
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    allowedVideoTypes: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv'],
    thumbnailSize: 512,
    tempDir: 'temp'
  },
  
  // Timeouts et retries
  timeouts: {
    azureImage: 10000,    // 10s pour images
    azureVideo: 30000,    // 30s pour vidéos
    r2Upload: 60000,      // 60s pour upload R2
    r2Download: 30000     // 30s pour download R2
  },
  
  retries: {
    azure: 3,
    r2: 3,
    delay: 1000,
    maxDelay: 10000
  },
  
  // Circuit breaker
  circuitBreaker: {
    azure: {
      timeout: 30000,
      errorThresholdPercentage: 50,
      resetTimeout: 60000
    },
    r2: {
      timeout: 60000,
      errorThresholdPercentage: 30,
      resetTimeout: 120000
    }
  },
  
  // Queue
  queue: {
    videoModeration: 'video-moderation',
    imageModeration: 'image-moderation',
    thumbnailGeneration: 'thumbnail-generation',
    concurrency: 2
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: 'logs/worker.log',
    maxSize: '10m',
    maxFiles: 5
  },
  
  // Cleanup
  cleanup: {
    tempFiles: {
      enabled: true,
      interval: '0 2 * * *', // Tous les jours à 2h du matin
      maxAge: 24 * 60 * 60 * 1000 // 24h
    }
  }
};

// Validation de la configuration
function validateConfig() {
  const required = [
    'r2.endpoint',
    'r2.accessKeyId', 
    'r2.secretAccessKey',
    'r2.bucketName',
    'azure.endpoint',
    'azure.key'
  ];
  
  const missing = [];
  
  for (const path of required) {
    const value = path.split('.').reduce((obj, key) => obj?.[key], config);
    if (!value) {
      missing.push(path);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(`Configuration manquante: ${missing.join(', ')}`);
  }
  
  console.log('✅ Configuration validée');
}

// Export avec validation
module.exports = {
  ...config,
  validate: validateConfig
}; 