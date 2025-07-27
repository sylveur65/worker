const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

// Configuration et services
const config = require('./config/config');
const { logger, logRequest } = require('./utils/logger');
const { 
  errorHandler, 
  notFoundHandler, 
  jsonErrorHandler,
  fileSizeErrorHandler,
  circuitBreakerErrorHandler 
} = require('./middlewares/errorHandler');
const FileService = require('./services/fileService');

// Routes
const moderationRoutes = require('./routes/moderationRoutes');

// Validation de la configuration au démarrage
config.validate();

// Création de l'application Express
const app = express();

// Middlewares de sécurité
app.use(helmet({
  contentSecurityPolicy: false, // Désactivé pour les APIs
  crossOriginEmbedderPolicy: false
}));

// CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limite chaque IP à 100 requêtes par fenêtre
  message: {
    success: false,
    error: {
      message: 'Too many requests from this IP, please try again later.',
      status: 429
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Parsing du JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging des requêtes
app.use(logRequest);

// Gestion des erreurs de parsing JSON
app.use(jsonErrorHandler);

// Routes
app.use('/', moderationRoutes);

// Gestion des erreurs de taille de fichier
app.use(fileSizeErrorHandler);

// Gestion des erreurs de circuit breaker
app.use(circuitBreakerErrorHandler);

// Gestionnaire d'erreurs 404
app.use(notFoundHandler);

// Gestionnaire d'erreurs global
app.use(errorHandler);

// Service de nettoyage des fichiers temporaires
const fileService = new FileService();

// Tâche cron pour nettoyer les fichiers temporaires
if (config.cleanup.tempFiles.enabled) {
  cron.schedule(config.cleanup.tempFiles.interval, async () => {
    try {
      logger.info('Starting scheduled temp files cleanup');
      const result = await fileService.cleanupTempFiles();
      logger.info('Scheduled temp files cleanup completed', result);
    } catch (error) {
      logger.error('Scheduled temp files cleanup failed', { error: error.message });
    }
  });
  
  logger.info('Scheduled temp files cleanup enabled', { 
    interval: config.cleanup.tempFiles.interval 
  });
}

// Gestion gracieuse de l'arrêt
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
  process.exit(1);
});

// Démarrage du serveur
const PORT = config.port;
app.listen(PORT, '0.0.0.0', () => {
  logger.info('🚀 Video moderation worker v2 started', {
    port: PORT,
    nodeEnv: config.nodeEnv,
    bucket: config.r2.bucketName,
    azureEndpoint: config.azure.endpoint,
    maxFileSize: `${(config.upload.maxFileSize / 1024 / 1024).toFixed(2)}MB`,
    thumbnailSize: config.upload.thumbnailSize
  });
  
  console.log(`🚀 Video moderation worker v2 running on port ${PORT}`);
  console.log(`📁 Bucket R2: ${config.r2.bucketName}`);
  console.log(`🔗 Endpoint R2: ${config.r2.endpoint}`);
  console.log(`🤖 Azure Content Safety: ${config.azure.endpoint}`);
  console.log(`⚙️  Environment: ${config.nodeEnv}`);
  console.log(`📊 Max file size: ${(config.upload.maxFileSize / 1024 / 1024).toFixed(2)}MB`);
});

module.exports = app; 