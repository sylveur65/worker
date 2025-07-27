const { logger, logError } = require('../utils/logger');

/**
 * Middleware pour forcer le type de contenu JSON
 */
const forceJsonContentType = (req, res, next) => {
  res.type('application/json');
  next();
};

/**
 * Middleware de gestion d'erreurs global
 */
const errorHandler = (err, req, res, next) => {
  // Log de l'erreur
  logError(err, {
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  // S'assurer que le type de contenu est JSON
  res.type('application/json');
  
  // Déterminer le code de statut
  let statusCode = 500;
  let message = 'Internal Server Error';
  let details = null;
  
  // Erreurs spécifiques
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
    details = err.message;
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    message = 'Unauthorized';
  } else if (err.name === 'ForbiddenError') {
    statusCode = 403;
    message = 'Forbidden';
  } else if (err.name === 'NotFoundError') {
    statusCode = 404;
    message = 'Not Found';
  } else if (err.name === 'FileTooLargeError') {
    statusCode = 413;
    message = 'File Too Large';
    details = err.message;
  } else if (err.name === 'InvalidFileTypeError') {
    statusCode = 415;
    message = 'Unsupported Media Type';
    details = err.message;
  } else if (err.name === 'CircuitBreakerOpenError') {
    statusCode = 503;
    message = 'Service Temporarily Unavailable';
    details = 'The service is temporarily unavailable due to high error rate';
  } else if (err.name === 'TimeoutError') {
    statusCode = 408;
    message = 'Request Timeout';
    details = err.message;
  } else if (err.message) {
    // Si l'erreur a un message, l'utiliser
    message = err.message;
  }
  
  // Réponse JSON structurée
  const response = {
    success: false,
    error: {
      message,
      status: statusCode,
      timestamp: new Date().toISOString(),
      path: req.url,
      method: req.method
    }
  };
  
  // Ajouter les détails si disponibles
  if (details) {
    response.error.details = details;
  }
  
  // Ajouter la stack trace en développement
  if (process.env.NODE_ENV === 'development' && err.stack) {
    response.error.stack = err.stack;
  }
  
  // Envoyer la réponse
  res.status(statusCode).json(response);
};

/**
 * Middleware pour gérer les erreurs 404
 */
const notFoundHandler = (req, res) => {
  res.type('application/json');
  res.status(404).json({
    success: false,
    error: {
      message: 'Endpoint not found',
      status: 404,
      timestamp: new Date().toISOString(),
      path: req.url,
      method: req.method
    }
  });
};

/**
 * Middleware pour gérer les erreurs de parsing JSON
 */
const jsonErrorHandler = (err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    res.type('application/json');
    res.status(400).json({
      success: false,
      error: {
        message: 'Invalid JSON',
        status: 400,
        timestamp: new Date().toISOString(),
        path: req.url,
        method: req.method,
        details: 'The request body contains invalid JSON'
      }
    });
  } else {
    next(err);
  }
};

/**
 * Middleware pour gérer les erreurs de timeout
 */
const timeoutHandler = (timeoutMs = 30000) => {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      const error = new Error('Request timeout');
      error.name = 'TimeoutError';
      error.status = 408;
      next(error);
    }, timeoutMs);
    
    res.on('finish', () => {
      clearTimeout(timer);
    });
    
    next();
  };
};

/**
 * Middleware pour gérer les erreurs de limite de taille
 */
const fileSizeErrorHandler = (err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    res.type('application/json');
    res.status(413).json({
      success: false,
      error: {
        message: 'File too large',
        status: 413,
        timestamp: new Date().toISOString(),
        path: req.url,
        method: req.method,
        details: 'The uploaded file exceeds the maximum allowed size'
      }
    });
  } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    res.type('application/json');
    res.status(400).json({
      success: false,
      error: {
        message: 'Unexpected file field',
        status: 400,
        timestamp: new Date().toISOString(),
        path: req.url,
        method: req.method,
        details: 'An unexpected file field was provided'
      }
    });
  } else {
    next(err);
  }
};

/**
 * Middleware pour gérer les erreurs de circuit breaker
 */
const circuitBreakerErrorHandler = (err, req, res, next) => {
  if (err.name === 'CircuitBreakerOpenError') {
    res.type('application/json');
    res.status(503).json({
      success: false,
      error: {
        message: 'Service temporarily unavailable',
        status: 503,
        timestamp: new Date().toISOString(),
        path: req.url,
        method: req.method,
        details: 'The service is temporarily unavailable due to high error rate. Please try again later.',
        retryAfter: 60 // 1 minute
      }
    });
  } else {
    next(err);
  }
};

/**
 * Classe d'erreurs personnalisées
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
    this.status = 401;
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
    this.status = 403;
  }
}

class NotFoundError extends Error {
  constructor(message = 'Not Found') {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

class FileTooLargeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileTooLargeError';
    this.status = 413;
  }
}

class InvalidFileTypeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidFileTypeError';
    this.status = 415;
  }
}

class CircuitBreakerOpenError extends Error {
  constructor(message = 'Circuit breaker is open') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.status = 503;
  }
}

class TimeoutError extends Error {
  constructor(message = 'Request timeout') {
    super(message);
    this.name = 'TimeoutError';
    this.status = 408;
  }
}

module.exports = {
  forceJsonContentType,
  errorHandler,
  notFoundHandler,
  jsonErrorHandler,
  timeoutHandler,
  fileSizeErrorHandler,
  circuitBreakerErrorHandler,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  FileTooLargeError,
  InvalidFileTypeError,
  CircuitBreakerOpenError,
  TimeoutError
}; 