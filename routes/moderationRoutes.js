const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const ModerationController = require('../controllers/moderationController');
const { forceJsonContentType, timeoutHandler } = require('../middlewares/errorHandler');
const config = require('../config/config');

const router = express.Router();
const controller = new ModerationController();

// Configuration multer avec stockage en mémoire
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSize,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [...config.upload.allowedImageTypes, ...config.upload.allowedVideoTypes];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`), false);
    }
  }
});

// Middleware de validation des erreurs
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        details: errors.array()
      }
    });
  }
  next();
};

// Middleware pour forcer le type JSON
router.use(forceJsonContentType);

// Routes de modération directe
router.post('/moderate-image', 
  upload.single('image'),
  timeoutHandler(config.timeouts.azureImage + 5000), // 5s de plus que Azure
  [
    body('creatorId').notEmpty().withMessage('Creator ID is required')
  ],
  handleValidationErrors,
  controller.moderateImage.bind(controller)
);

router.post('/moderate-video',
  upload.single('video'),
  timeoutHandler(config.timeouts.azureVideo + 10000), // 10s de plus que Azure
  [
    body('creatorId').notEmpty().withMessage('Creator ID is required')
  ],
  handleValidationErrors,
  controller.moderateVideo.bind(controller)
);

// Routes de modération depuis R2
router.post('/worker-api/moderate-image-r2',
  timeoutHandler(config.timeouts.azureImage + 10000), // 10s de plus pour inclure download R2
  [
    body('r2Key').notEmpty().withMessage('R2 key is required'),
    body('type').notEmpty().withMessage('File type is required'),
    body('creatorId').optional()
  ],
  handleValidationErrors,
  controller.moderateImageFromR2.bind(controller)
);

router.post('/worker-api/moderate-video-r2',
  timeoutHandler(config.timeouts.azureVideo + 15000), // 15s de plus pour inclure download R2
  [
    body('r2Key').notEmpty().withMessage('R2 key is required'),
    body('creatorId').notEmpty().withMessage('Creator ID is required'),
    body('type').optional()
  ],
  handleValidationErrors,
  controller.moderateVideoFromR2.bind(controller)
);

// Routes pour presigned URLs
router.post('/worker-api/presigned-upload',
  [
    body('key').notEmpty().withMessage('Key is required'),
    body('contentType').notEmpty().withMessage('Content type is required')
  ],
  handleValidationErrors,
  controller.generateUploadUrl.bind(controller)
);

router.post('/worker-api/presigned-read',
  [
    body('key').notEmpty().withMessage('Key is required')
  ],
  handleValidationErrors,
  controller.generateReadUrl.bind(controller)
);

// Route de test des règles de modération
router.post('/worker-api/test-moderation',
  [
    body('testCategories').isArray().withMessage('testCategories must be an array'),
    body('testCategories.*.category').notEmpty().withMessage('Category is required'),
    body('testCategories.*.severity').isNumeric().withMessage('Severity must be a number')
  ],
  handleValidationErrors,
  controller.testModerationRules.bind(controller)
);

// Route pour les métriques
router.get('/worker-api/metrics',
  controller.getMetrics.bind(controller)
);

// Route de santé
router.get('/worker-api/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// Route racine
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Video moderation worker v2 is running',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

module.exports = router; 