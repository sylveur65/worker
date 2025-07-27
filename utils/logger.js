const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');

// Créer le dossier logs s'il n'existe pas
const logsDir = path.dirname(config.logging.file);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Format personnalisé pour les logs
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    
    if (stack) {
      log += `\n${stack}`;
    }
    
    return log;
  })
);

// Configuration des transports
const transports = [
  // Console en développement
  new winston.transports.Console({
    level: config.nodeEnv === 'development' ? 'debug' : 'info',
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  })
];

// Fichier en production
if (config.nodeEnv === 'production') {
  transports.push(
    new winston.transports.File({
      filename: config.logging.file,
      level: config.logging.level,
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
      format: logFormat
    })
  );
}

// Logger principal
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports,
  exitOnError: false
});

// Logger spécialisé pour les erreurs
const errorLogger = winston.createLogger({
  level: 'error',
  format: logFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'errors.log'),
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles
    })
  ]
});

// Logger spécialisé pour les métriques
const metricsLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'metrics.log'),
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles
    })
  ]
});

// Fonctions utilitaires
const logRequest = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    };
    
    if (res.statusCode >= 400) {
      logger.warn('Request completed with error', logData);
    } else {
      logger.info('Request completed', logData);
    }
    
    // Métriques
    metricsLogger.info('request', {
      ...logData,
      timestamp: new Date().toISOString()
    });
  });
  
  next();
};

const logError = (error, context = {}) => {
  errorLogger.error(error.message, {
    stack: error.stack,
    context,
    timestamp: new Date().toISOString()
  });
};

const logModeration = (data) => {
  logger.info('Moderation result', {
    verdict: data.verdict,
    ai_score: data.ai_score,
    categories: data.categories,
    fileType: data.fileType,
    fileSize: data.fileSize,
    processingTime: data.processingTime
  });
};

const logStorage = (operation, data) => {
  logger.info(`Storage ${operation}`, {
    key: data.key,
    size: data.size,
    type: data.type,
    duration: data.duration
  });
};

module.exports = {
  logger,
  errorLogger,
  metricsLogger,
  logRequest,
  logError,
  logModeration,
  logStorage
}; 